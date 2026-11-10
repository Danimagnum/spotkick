import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { botZone, commitment, fairZone, hmac256, sha256, phaseFor, roundOf, pointsFor, winnerAfter, pvpPayout, isGoal, MatchView, Player, Zone, assertTransition } from '@spotkick/shared';
import { Database, event } from '../database/db';
import { Ledger } from '../wallet/ledger';
import { CoreRequestError } from '../wallet/core-client';
import { Identity } from '../identity';
import { RedisService } from '../redis';
interface Secret {
    choice: Zone;
    salt: string;
}
export interface MatchState extends MatchView {
    core?: { expiresAt: string; action?: 'reserve' | 'settle' | 'release'; cancel?: boolean; attempts?: number };
    seed: string;
    commits: Record<string, string>;
    reveals: Record<string, Secret>;
    fallbacks: Record<string, Secret>;
    timedOut: string[];
    audit: {
        exchange: number;
        commitments: Record<string, string>;
        reveals: Record<string, Secret>;
        timeouts: string[];
    }[];
    transitions: {
        phase: string;
        at: number;
    }[];
}
export const choiceMs = () => Number(process.env.CHOICE_MS || 10000);
export const revealMs = () => Number(process.env.REVEAL_MS || 3000);
@Injectable()
export class MatchEngine {
    constructor(private db: Database, private ledger: Ledger, private identity: Identity, private redis: RedisService) { }
    view(s: MatchState): MatchView & {
        audit?: MatchState['audit'];
    } {
        const { seed, commits, reveals, fallbacks, timedOut, audit, transitions, core, ...safe } = s;
        return { ...safe, committed: Object.keys(commits), commitments: { ...commits }, revealed: Object.keys(reveals), ...(s.phase === 'SETTLED' || s.phase === 'ABANDONED' ? { timeoutSeed: seed, audit } : {}) };
    }
    transition(s: MatchState, to: MatchView['phase'], now: number) { assertTransition(s.phase, to); s.phase = to; s.transitions.push({ phase: to, at: now }); }
    async persist(m: EntityManager, s: MatchState) {
        s.version++;
        await m.query('UPDATE matches SET status=$2,state=$3,updated_at=now() WHERE id=$1', [s.id, s.phase, JSON.stringify(s)]);
        await event(m, 'match', this.view(s));
    }
    async get(id: string, user: string) { const [r] = await this.db.source.query('SELECT state FROM matches WHERE id=$1', [id]); if (!r || !r.state.players.some((p: Player) => p.id === user))
        throw new Error('Match not found'); return this.view(r.state); }
    async queue(user: string, stake: number) {
        const core = this.identity.core;
        const available = core.enabled ? BigInt((await core.wallet(user)).available) : undefined;
        await this.db.tx(async (m) => {
            const [u] = await m.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [user]);
            if (u.active_game)
                throw new Error('Finish your active game first');
            if ((available ?? await this.ledger.balance(m, `user:${user}`)) < BigInt(stake))
                throw new Error('Insufficient available balance');
            if (u.queue_stake && u.queue_stake !== stake)
                throw new Error('Cancel your existing queue first');
            await m.query('UPDATE users SET queue_stake=$2,queued_at=COALESCE(queued_at,$3) WHERE id=$1', [user, stake, Date.now()]);
        });
        await this.redis.client.zadd('spotkick:queue', 'NX', Date.now(), user);
        return { queued: true, stake };
    }
    async cancel(user: string) { await this.db.source.query('UPDATE users SET queue_stake=NULL,queued_at=NULL WHERE id=$1', [user]); await this.redis.client.zrem('spotkick:queue', user); return { queued: false }; }
    async practice(user: string, stake: number) {
        if (this.identity.core.enabled) throw new Error('Practice is available in play-money mode only');
        return this.db.tx(async (m) => {
            const [player] = await m.query(
                'SELECT id, name, bot, active_game, queue_stake FROM users WHERE id=$1 AND NOT core_user AND NOT bot FOR UPDATE',
                [user],
            );
            if (!player) throw new Error('Guest session required');
            if (player.active_game) throw new Error('Finish your active game first');
            if (player.queue_stake) throw new Error('Cancel your existing queue first');
            const bot = await this.identity.create(true, m);
            const id = await this.create(m, [player, bot], stake);
            return { id };
        });
    }
    async matchmake() {
        // Rebuild the disposable Redis index after eviction/restart.
        const core = this.identity.core.enabled;
        const waiting = await this.db.source.query('SELECT id,queued_at FROM users WHERE queue_stake IS NOT NULL AND active_game IS NULL AND core_user=$1', [core]);
        if (waiting.length) {
            const batch = this.redis.client.multi();
            for (const u of waiting)
                batch.zadd('spotkick:queue', 'NX', u.queued_at, u.id);
            await batch.exec();
        }
        const ids = await this.redis.client.zrange('spotkick:queue', 0, 49);
        if (!ids.length)
            return;
        await this.db.tx(async (m) => {
            const [{ locked }] = await m.query('SELECT pg_try_advisory_xact_lock(481591) AS locked');
            if (!locked)
                return;
            const candidates = await m.query('SELECT * FROM users WHERE id=ANY($1::uuid[]) AND queue_stake IS NOT NULL AND active_game IS NULL AND core_user=$2 ORDER BY queued_at,id FOR UPDATE SKIP LOCKED', [ids, core]);
            if (!candidates.length)
                return;
            const a = candidates[0];
            let b = candidates.find((x: typeof a) => x.id !== a.id && x.queue_stake === a.queue_stake);
            if (!b && (core || Date.now() - Number(a.queued_at) < Number(process.env.BOT_AFTER_MS || 5000)))
                return;
            if (!b)
                b = await this.identity.create(true, m);
            await this.create(m, [a, b].map(p => ({ id: p.id, name: p.name, bot: p.bot })), a.queue_stake);
        });
        const stillWaiting = new Set((await this.db.source.query('SELECT id FROM users WHERE queue_stake IS NOT NULL AND core_user=$1', [core])).map((x: {
            id: string;
        }) => x.id));
        const stale = ids.filter(id => !stillWaiting.has(id));
        if (stale.length)
            await this.redis.client.zrem('spotkick:queue', ...stale);
    }
    async create(m: EntityManager, players: Player[], stake: number) {
        players = players.map(({id,name,bot}) => ({id,name,bot}));
        const id = randomUUID(), seed = randomBytes(32).toString('hex'), now = Date.now();
        const s: MatchState = { id, phase: 'MATCHED', version: 0, players, stake, pot: stake * 2, rakeBps: Number(process.env.RAKE_BPS || 300), exchange: 0, round: 1, shooter: 0, score: [0, 0], deadline: now + choiceMs(), committed: [], commitments: {}, revealed: [], results: [], timeoutSeedHash: await sha256(seed), seed, commits: {}, reveals: {}, fallbacks: {}, timedOut: [], audit: [], transitions: [{ phase: 'QUEUED', at: now }, { phase: 'MATCHED', at: now }] };
        if (this.identity.core.enabled) {
            if (players.some(player => player.bot)) throw new Error('Core matches require two players');
            s.core = { action: 'reserve', expiresAt: new Date(now + 30 * 60_000).toISOString() };
            s.deadline = now;
        } else {
            await this.ledger.account(m, `escrow:${id}`, 'ESCROW');
            await this.ledger.post(m, `match:${id}:stake`, 'STAKES_LOCKED', id, [...players.map(p => ({ account: `user:${p.id}`, amount: -BigInt(stake) })), { account: `escrow:${id}`, amount: BigInt(stake * 2) }]);
            this.transition(s, 'STAKES_LOCKED', now);
            this.transition(s, phaseFor(0), now);
        }
        await m.query('INSERT INTO matches(id,status,state) VALUES($1,$2,$3)', [id, s.phase, JSON.stringify(s)]);
        for (const p of players) {
            await m.query('UPDATE users SET active_game=$2,queue_stake=NULL,queued_at=NULL WHERE id=$1', [p.id, `match:${id}`]);
            await event(m, `user:${p.id}`, { matchId: id });
        }
        if (!s.core) await this.drive(m, s, now);
        await this.persist(m, s);
        return id;
    }
    async fallback(s: MatchState, user: string): Promise<Secret> { return { choice: await fairZone(s.seed, `timeout:${s.id}:${user}`, s.exchange), salt: await hmac256(s.seed, `salt:${s.exchange}:${user}`) }; }
    async drive(m: EntityManager, s: MatchState, now: number) {
        if (s.phase === 'SETTLED' || s.phase === 'ABANDONED')
            return;
        if (s.phase === 'RESOLVED') {
            if (now < s.deadline)
                return;
            s.exchange++;
            s.round = roundOf(s.exchange);
            s.shooter = s.exchange % 2;
            s.commits = {};
            s.reveals = {};
            s.fallbacks = {};
            s.timedOut = [];
            this.transition(s, phaseFor(s.exchange), now);
            s.deadline = now + choiceMs();
        }
        if (s.phase.endsWith('_COMMIT')) {
            for (const p of s.players)
                if (p.bot && !s.commits[p.id]) {
                    const secret = { choice: await botZone(s.seed, p.id, s.exchange), salt: await hmac256(s.seed, `bot-salt:${p.id}:${s.exchange}`) };
                    s.fallbacks[p.id] = secret;
                    s.commits[p.id] = await commitment(s.id, s.exchange, p.id, secret.choice, secret.salt);
                }
            if (now >= s.deadline)
                for (const p of s.players)
                    if (!s.commits[p.id]) {
                        const secret = await this.fallback(s, p.id);
                        s.fallbacks[p.id] = secret;
                        s.timedOut.push(p.id);
                        s.commits[p.id] = await commitment(s.id, s.exchange, p.id, secret.choice, secret.salt);
                    }
            if (Object.keys(s.commits).length === 2) {
                this.transition(s, phaseFor(s.exchange, true), now);
                s.deadline = now + revealMs();
                Object.assign(s.reveals, s.fallbacks);
            }
        }
        if (s.phase.endsWith('_REVEAL')) {
            if (now >= s.deadline)
                for (const p of s.players)
                    if (!s.reveals[p.id]) {
                        s.reveals[p.id] = await this.fallback(s, p.id);
                        s.timedOut.push(p.id);
                    }
            if (Object.keys(s.reveals).length !== 2)
                return;
            const shooter = s.players[s.shooter], keeper = s.players[1 - s.shooter];
            const shot = s.reveals[shooter.id].choice, save = s.reveals[keeper.id].choice;
            const goal = isGoal(shot, save), points = goal ? pointsFor(s.round) : 0;
            s.score[s.shooter] += points;
            s.results.push({ index: s.exchange, round: s.round, shooter: s.shooter, shot, keeper: save, goal, points, timeouts: [...s.timedOut] });
            s.audit.push({ exchange: s.exchange, commitments: { ...s.commits }, reveals: { ...s.reveals }, timeouts: [...s.timedOut] });
            this.transition(s, 'RESOLVED', now);
            const winner = winnerAfter(s.score, s.exchange);
            if (winner !== null) {
                const p = pvpPayout(s.stake, s.rakeBps);
                s.winner = s.players[winner].id;
                if (s.core) {
                    s.core.action = 'settle';
                    s.deadline = now;
                    return;
                }
                s.payout = p.payout;
                await this.ledger.post(m, `match:${s.id}:settle`, 'SETTLED', s.id, [{ account: `escrow:${s.id}`, amount: -BigInt(p.pot) }, { account: `user:${s.winner}`, amount: BigInt(p.payout) }, ...(p.rake ? [{ account: 'house:rake', amount: BigInt(p.rake) }] : [])]);
                this.transition(s, 'SETTLED', now);
                s.timeoutSeed = s.seed;
                await m.query('UPDATE users SET active_game=NULL WHERE active_game=$1', [`match:${s.id}`]);
            }
            else
                s.deadline = now + Number(process.env.RESULT_MS || 1600);
        }
    }
    async command(id: string, user: string, exchange: number, action: 'commit' | 'reveal', payload: string | Secret) {
        return this.db.tx(async (m) => {
            const [r] = await m.query('SELECT state FROM matches WHERE id=$1 FOR UPDATE', [id]);
            if (!r || !r.state.players.some((p: Player) => p.id === user))
                throw new Error('Match not found');
            const s = r.state as MatchState;
            if (exchange !== s.exchange)
                throw new Error('Stale exchange');
            if (action === 'commit' && s.commits[user] === payload)
                return this.view(s);
            if (action === 'reveal' && s.reveals[user] && JSON.stringify(s.reveals[user]) === JSON.stringify(payload))
                return this.view(s);
            if (s.core?.action)
                throw new Error('Wallet operation pending');
            if (Date.now() >= s.deadline)
                throw new Error('Choice deadline passed');
            if (action === 'commit') {
                if (!s.phase.endsWith('_COMMIT') || s.commits[user])
                    throw new Error('Commit phase closed');
                s.commits[user] = payload as string;
            }
            else {
                if (!s.phase.endsWith('_REVEAL') || s.reveals[user])
                    throw new Error('Reveal phase closed');
                const secret = payload as Secret;
                if (await commitment(id, exchange, user, secret.choice, secret.salt) !== s.commits[user])
                    throw new Error('Commitment verification failed');
                s.reveals[user] = secret;
            }
            await this.drive(m, s, Date.now());
            await this.persist(m, s);
            return this.view(s);
        });
    }
    async tick() {
        const active = await this.db.source.query("SELECT id FROM matches WHERE status NOT IN ('SETTLED','ABANDONED')");
        for (const { id } of active)
            await this.db.tx(async (m) => {
                const [r] = await m.query('SELECT state FROM matches WHERE id=$1 FOR UPDATE SKIP LOCKED', [id]);
                if (!r) return;
                const s = r.state as MatchState;
                const now = Date.now();
                if (now < s.deadline) return;
                if (s.core && (s.core.action || now >= Date.parse(s.core.expiresAt))) {
                    s.core.action ??= 'release';
                    await this.processCore(m, s);
                } else {
                    await this.drive(m, s, now);
                }
                await this.persist(m, s);
            });
    }
    private async processCore(m: EntityManager, s: MatchState) {
        const state = s.core!;
        const action = state.action!;
        let result;
        try {
            result = await this.identity.core.match(s.id, action, action === 'reserve'
                ? { userIds: s.players.map(player => player.id), amount: String(s.stake), expiresAt: state.expiresAt }
                : action === 'settle' ? { winnerId: s.winner, rakeBps: s.rakeBps } : {});
        } catch (error) {
            if (error instanceof CoreRequestError) {
                if (action === 'reserve' && [
                    'kyc_required', 'account_restricted', 'loss_limit_exceeded', 'insufficient_funds',
                    'hold_expired', 'currency_not_supported', 'wallet_not_found',
                ].includes(error.code)) {
                    await this.abandonCoreMatch(m, s);
                    return;
                }
                if (action === 'settle' && error.code === 'hold_expired') state.action = 'release';
            }
            state.attempts = (state.attempts ?? 0) + 1;
            if (state.attempts === 1)
                console.warn(JSON.stringify({ event: 'core.match.retry', matchId: s.id, action, code: error instanceof CoreRequestError ? error.code : 'transport_error' }));
            s.deadline = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(state.attempts, 5));
            return;
        }
        delete state.attempts;
        const now = Date.now();
        if (action === 'reserve') {
            if (state.cancel || now >= Date.parse(state.expiresAt)) {
                state.action = 'release';
                s.deadline = now;
            } else {
                delete state.action;
                this.transition(s, 'STAKES_LOCKED', now);
                this.transition(s, phaseFor(0), now);
                s.deadline = now + choiceMs();
            }
        } else if (action === 'settle') {
            s.payout = Number(result.payout);
            this.transition(s, 'SETTLED', now);
            s.timeoutSeed = s.seed;
            await this.clearCoreMatch(m, s);
        } else {
            await this.abandonCoreMatch(m, s);
        }
    }
    private async clearCoreMatch(m: EntityManager, s: MatchState) {
        delete s.core!.action;
        await m.query('UPDATE users SET active_game=NULL WHERE active_game=$1', [`match:${s.id}`]);
    }
    private async abandonCoreMatch(m: EntityManager, s: MatchState) {
        delete s.winner;
        delete s.payout;
        this.transition(s, 'ABANDONED', Date.now());
        await this.clearCoreMatch(m, s);
    }
    async abandon(id: string) {
        await this.db.tx(async (m) => {
            const [r] = await m.query('SELECT state FROM matches WHERE id=$1 FOR UPDATE', [id]);
            if (!r)
                return;
            const s = r.state as MatchState;
            if (s.phase === 'SETTLED' || s.phase === 'ABANDONED')
                return;
            if (s.core) {
                if (s.core.action === 'settle') return;
                if (s.core.action === 'reserve') s.core.cancel = true;
                else s.core.action = 'release';
                s.deadline = Date.now();
                await this.persist(m, s);
                return;
            }
            await this.ledger.post(m, `match:${id}:refund`, 'REFUND', id, [{ account: `escrow:${id}`, amount: -BigInt(s.pot) }, ...s.players.map(p => ({ account: `user:${p.id}`, amount: BigInt(s.stake) }))]);
            this.transition(s, 'ABANDONED', Date.now());
            await m.query('UPDATE users SET active_game=NULL WHERE active_game=$1', [`match:${id}`]);
            await this.persist(m, s);
        });
    }
}
