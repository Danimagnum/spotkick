import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { fairZone, sha256, soloPayout, SoloView, Zone } from '@spotkick/shared';
import { Database, event } from '../database/db';
import { Ledger, fingerprint } from '../wallet/ledger';
interface SoloState extends SoloView {
    seed: string;
    reserved: number;
    startFingerprint: string;
}
@Injectable()
export class SoloService {
    constructor(private db: Database, private ledger: Ledger) { }
    view(s: SoloState): SoloView { const { seed, reserved, startFingerprint, ...safe } = s; return { ...safe, ...(s.status !== 'ACTIVE' ? { serverSeed: seed } : {}) }; }
    async seed(user: string) { const id = randomUUID(), seed = randomBytes(32).toString('hex'), hash = await sha256(seed); await this.db.source.query('INSERT INTO solo_seeds(id,owner_id,server_seed,seed_hash) VALUES($1,$2,$3,$4)', [id, user, seed, hash]); return { id, hash }; }
    async get(id: string, user: string) { const [r] = await this.db.source.query('SELECT state FROM solo_sessions WHERE id=$1 AND owner_id=$2', [id, user]); if (!r)
        throw new Error('Solo session not found'); return this.view(r.state); }
    async start(user: string, input: {
        stake: number;
        seedId: string;
        clientSeed: string;
        key: string;
    }) {
        return this.db.tx(async (m) => {
            await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`solo-start:${input.key}`]);
            const [existing] = await m.query('SELECT state,owner_id FROM solo_sessions WHERE start_key=$1', [input.key]);
            if (existing) {
                if (existing.owner_id !== user || existing.state.startFingerprint !== fingerprint({user,...input}))
                    throw new Error('Idempotency conflict');
                return this.view(existing.state);
            }
            const [u] = await m.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [user]);
            if (u.active_game || u.queue_stake)
                throw new Error('Finish or cancel your current game first');
            const [seed] = await m.query('SELECT * FROM solo_seeds WHERE id=$1 AND owner_id=$2 AND used=false FOR UPDATE', [input.seedId, user]);
            if (!seed)
                throw new Error('Get a fresh seed commitment first');
            const id = randomUUID(), reserved = soloPayout(input.stake, 1);
            await this.ledger.account(m, `solo:${id}`, 'ESCROW');
            await this.ledger.post(m, `solo:${id}:stake`, 'SOLO_STAKE', id, [{ account: `user:${user}`, amount: -BigInt(input.stake) }, { account: 'house:bankroll', amount: -BigInt(reserved - input.stake) }, { account: `solo:${id}`, amount: BigInt(reserved) }]);
            const s: SoloState = { id, stake: input.stake, clientSeed: input.clientSeed, serverSeedHash: seed.seed_hash, seed: seed.server_seed, nonce: 0, goals: 0, payout: 0, status: 'ACTIVE', history: [], reserved, startFingerprint:fingerprint({user,...input}) };
            await m.query('INSERT INTO solo_sessions(id,owner_id,start_key,state) VALUES($1,$2,$3,$4)', [id, user, input.key, JSON.stringify(s)]);
            await m.query('UPDATE solo_seeds SET used=true WHERE id=$1', [input.seedId]);
            await m.query('UPDATE users SET active_game=$2 WHERE id=$1', [user, `solo:${id}`]);
            await event(m, `user:${user}`, { walletChanged: true });
            return this.view(s);
        });
    }
    async action(user: string, input: {
        id: string;
        key: string;
        nonce: number;
        choice?: Zone;
    }, cashout = false) {
        return this.db.tx(async (m) => {
            await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`solo-action:${input.key}`]);
            const hash = fingerprint({ user, ...input, cashout });
            const [previous] = await m.query('SELECT * FROM request_keys WHERE key=$1', [input.key]);
            if (previous) {
                if (previous.owner_id !== user || previous.fingerprint !== hash)
                    throw new Error('Idempotency conflict');
                return previous.response;
            }
            const [r] = await m.query('SELECT state FROM solo_sessions WHERE id=$1 AND owner_id=$2 FOR UPDATE', [input.id, user]);
            if (!r)
                throw new Error('Solo session not found');
            const s = r.state as SoloState;
            if (s.status !== 'ACTIVE' || s.nonce !== input.nonce)
                throw new Error('Stale solo action');
            if (cashout) {
                if (s.goals < 1)
                    throw new Error('Score a goal before cashing out');
                await this.pay(m, s, user, input.key);
            }
            else {
                if (!input.choice)
                    throw new Error('Choose a zone');
                // Reserve the entire next liability before exposing another outcome.
                const needed = soloPayout(s.stake, s.goals + 1), delta = needed - s.reserved;
                if (delta > 0) {
                    if (await this.ledger.balance(m, 'house:bankroll') < BigInt(delta))
                        throw new Error('House capacity reached; cash out your current payout');
                    await this.ledger.post(m, `solo:${input.key}:reserve`, 'SOLO_RESERVE', s.id, [{ account: 'house:bankroll', amount: -BigInt(delta) }, { account: `solo:${s.id}`, amount: BigInt(delta) }]);
                    s.reserved = needed;
                }
                const keeper = await fairZone(s.seed, s.clientSeed, s.nonce), goal = keeper !== input.choice;
                s.history.push({ nonce: s.nonce, shot: input.choice, keeper, goal });
                s.nonce++;
                if (goal) {
                    s.goals++;
                    s.payout = soloPayout(s.stake, s.goals);
                }
                else {
                    s.status = 'LOST';
                    s.payout = 0;
                    await this.ledger.post(m, `solo:${s.id}:settle`, 'SOLO_LOSS', s.id, [{ account: `solo:${s.id}`, amount: -BigInt(s.reserved) }, { account: 'house:bankroll', amount: BigInt(s.reserved) }]);
                }
            }
            if (s.status !== 'ACTIVE')
                await m.query('UPDATE users SET active_game=NULL WHERE id=$1', [user]);
            await m.query('UPDATE solo_sessions SET state=$2,updated_at=now() WHERE id=$1', [s.id, JSON.stringify(s)]);
            const response = this.view(s);
            await m.query('INSERT INTO request_keys(key,owner_id,fingerprint,response) VALUES($1,$2,$3,$4)', [input.key, user, hash, JSON.stringify(response)]);
            await event(m, `user:${user}`, { walletChanged: true });
            return response;
        });
    }
    private async pay(m: import('typeorm').EntityManager, s: SoloState, user: string, key: string) {
        const remainder = s.reserved - s.payout;
        await this.ledger.post(m, `solo:${s.id}:settle`, 'SOLO_CASHOUT', s.id, [{ account: `solo:${s.id}`, amount: -BigInt(s.reserved) }, { account: `user:${user}`, amount: BigInt(s.payout) }, ...(remainder ? [{ account: 'house:bankroll', amount: BigInt(remainder) }] : [])]);
        s.status = 'CASHED_OUT';
    }
}
