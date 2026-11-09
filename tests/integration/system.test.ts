import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import { commitment, sha256, zones, Zone } from '@spotkick/shared';
import { Database } from '../../apps/api/src/database/db';
import { Ledger } from '../../apps/api/src/wallet/ledger';
import { Identity } from '../../apps/api/src/identity';
import { RedisService } from '../../apps/api/src/redis';
import { MatchEngine, MatchState } from '../../apps/api/src/matches/engine';
import { SoloService } from '../../apps/api/src/solo/solo';
const db = new Database(), ledger = new Ledger(), identity = new Identity(db, ledger), redis = new RedisService(), engine = new MatchEngine(db, ledger, identity, redis), solo = new SoloService(db, ledger);
beforeAll(async () => { await db.onModuleInit(); await redis.client.ping(); process.env.BOT_AFTER_MS = '0'; process.env.RESULT_MS = '0'; });
afterAll(async () => { redis.client.disconnect(); await db.onModuleDestroy(); });
const balance = (id: string) => ledger.balance(db.source.manager, id);
async function advance(id: string) { return db.tx(async (m) => { const [r] = await m.query('SELECT state FROM matches WHERE id=$1 FOR UPDATE', [id]); const s = r.state as MatchState; await engine.drive(m, s, Math.max(Date.now(), s.deadline + 1)); await engine.persist(m, s); return engine.view(s); }); }
describe('PostgreSQL journal under contention', () => {
    it('conserves money across 100 simultaneous bets and 100 duplicate settlements', async () => {
        const user = await identity.create(), wallet = `user:${user.id}`, stake = 3000n;
        const bets = Array.from({ length: 100 }, () => randomUUID());
        const result = await Promise.allSettled(bets.map(id => db.tx(async (m) => { await ledger.account(m, `test:${id}`, 'ESCROW'); await ledger.post(m, `bet:${id}`, 'BET', id, [{ account: wallet, amount: -stake }, { account: `test:${id}`, amount: stake }]); return id; })));
        const accepted = result.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map(r => r.value);
        expect(accepted).toHaveLength(33);
        expect(await balance(wallet)).toBe(1000n);
        for (const r of result)
            if (r.status === 'rejected')
                expect(r.reason.message).toContain('Insufficient');
        const payouts = await Promise.all(Array.from({ length: 100 }, (_, i) => { const id = accepted[i % accepted.length]; return db.tx(m => ledger.post(m, `settle:${id}`, 'SETTLE', id, [{ account: `test:${id}`, amount: -stake }, { account: wallet, amount: 2910n }, { account: 'house:rake', amount: 90n }])); }));
        expect(payouts.filter(Boolean)).toHaveLength(33);
        expect(await balance(wallet)).toBe(97030n);
        const [{ total }] = await db.source.query('SELECT SUM(amount)::text AS total FROM ledger_entries');
        expect(total).toBe('0');
        const negative = await db.source.query("SELECT a.id FROM accounts a JOIN ledger_entries e ON e.account_id=a.id WHERE a.kind<>'ISSUANCE' GROUP BY a.id HAVING SUM(e.amount)<0");
        expect(negative).toEqual([]);
        for (const id of accepted)
            expect(await balance(`test:${id}`)).toBe(0n);
    });
    it('rejects mutation, unbalanced raw SQL and conflicting idempotency keys', async () => {
        await expect(db.source.query('UPDATE ledger_entries SET amount=amount WHERE id=(SELECT MIN(id) FROM ledger_entries)')).rejects.toThrow('immutable');
        await expect(db.source.query("INSERT INTO ledger_entries(transaction_id,account_id,amount) SELECT id,'issuance',1 FROM ledger_transactions LIMIT 1")).rejects.toThrow('sealed');
        await expect(db.tx(async (m) => { const id = randomUUID(); await m.query("INSERT INTO ledger_transactions(id,idempotency_key,fingerprint,operation) VALUES($1,$2,'x','BROKEN')", [id, id]); await m.query("INSERT INTO ledger_entries(transaction_id,account_id,amount) VALUES($1,'issuance',1)", [id]); })).rejects.toThrow('Unbalanced');
        await expect(db.tx(m => ledger.post(m, 'house:initial', 'ISSUE', 'house', [{ account: 'issuance', amount: -1n }, { account: 'house:bankroll', amount: 1n }]))).rejects.toThrow('Idempotency');
    });
});
describe('authoritative matches', () => {
    it('plays all six exchanges, verifies reveals, recovers snapshots and settles exactly once', async () => {
        const a = await identity.create(), b = await identity.create();
        await db.tx(m => engine.create(m, [a, b], 1000));
        const [row] = await db.source.query('SELECT active_game FROM users WHERE id=$1', [a.id]);
        const id = row.active_game.slice(6);
        let view = await engine.get(id, a.id);
        expect(view.phase).toBe('ROUND_1_COMMIT');
        expect(view).not.toHaveProperty('seed');
        expect(view.players[0]).not.toHaveProperty('token');
        expect(await balance(`user:${a.id}`)).toBe(99000n);
        await expect(engine.get(id, randomUUID())).rejects.toThrow();
        for (let exchange = 0; exchange < 6; exchange++) {
            const choices: Zone[] = exchange % 2 === 0 ? ['left', 'right'] : ['left', 'left'];
            const salt = 'a'.repeat(64);
            await Promise.all([a, b].map(async (p, i) => engine.command(id, p.id, exchange, 'commit', await commitment(id, exchange, p.id, choices[i], salt))));
            expect((await engine.get(id, a.id)).phase).toContain('REVEAL');
            await expect(engine.command(id, a.id, exchange, 'reveal', { choice: choices[0], salt: 'b'.repeat(64) })).rejects.toThrow('verification');
            await Promise.all([a, b].map((p, i) => engine.command(id, p.id, exchange, 'reveal', { choice: choices[i], salt })));
            view = await engine.get(id, a.id);
            if (exchange < 5)
                view = await advance(id);
        }
        expect(view.phase).toBe('SETTLED');
        expect(view.score).toEqual([6, 0]);
        expect(view.winner).toBe(a.id);
        expect(view.payout).toBe(1940);
        expect(view.timeoutSeed && await sha256(view.timeoutSeed)).toBe(view.timeoutSeedHash);
        expect(await balance(`escrow:${id}`)).toBe(0n);
        expect(await balance(`user:${a.id}`)).toBe(100940n);
        expect(await balance(`user:${b.id}`)).toBe(99000n);
        await engine.tick();
        await engine.abandon(id);
        expect(await balance(`user:${a.id}`)).toBe(100940n);
        await expect(engine.command(id, a.id, 0, 'commit', 'c'.repeat(64))).rejects.toThrow('Stale');
    });
    it('uses a real Redis queue, delayed bot path and durable timeout fallback', async () => {
        const user = await identity.create();
        await engine.queue(user.id, 500);
        await engine.matchmake();
        const [u] = await db.source.query('SELECT active_game FROM users WHERE id=$1', [user.id]);
        expect(u.active_game).toMatch(/^match:/);
        const id = u.active_game.slice(6);
        const before = await engine.get(id, user.id);
        expect(before.players.some(p => p.bot)).toBe(true);
        const after = await advance(id);
        expect(after.results[0].timeouts).toContain(user.id);
        expect(after.phase).toBe('RESOLVED');
        expect((await engine.get(id, user.id)).version).toBe(after.version);
        await engine.abandon(id);
        await engine.abandon(id);
        expect(await balance(`user:${user.id}`)).toBe(100000n);
        expect(await balance(`escrow:${id}`)).toBe(0n);
    });
    it('starts one practice match on duplicate requests without taking a waiting human', async () => {
        const player = await identity.create(), waiting = await identity.create();
        await engine.queue(waiting.id, 500);
        const results = await Promise.allSettled([
            engine.practice(player.id, 500),
            engine.practice(player.id, 500),
        ]);
        const started = results.filter(result => result.status === 'fulfilled');
        expect(started).toHaveLength(1);
        const { id } = started[0].value;
        const view = await engine.get(id, player.id);
        expect(view.players.map(p => p.bot)).toEqual([false, true]);
        expect(await balance(`user:${player.id}`)).toBe(99500n);
        const [queued] = await db.source.query('SELECT queue_stake, active_game FROM users WHERE id=$1', [waiting.id]);
        expect(queued).toEqual({ queue_stake: 500, active_game: null });
        await engine.abandon(id);
        await engine.cancel(waiting.id);
    });
});
describe('solo escrow and provable fairness', () => {
    it('reserves liability, deduplicates concurrent shots and pays cash-out once', async () => {
        const u = await identity.create(), seed = await solo.seed(u.id), startKey = randomUUID();
        const v = await solo.start(u.id, { stake: 1000, seedId: seed.id, clientSeed: 'integration', key: startKey });
        expect(v).not.toHaveProperty('seed');
        expect(v.serverSeed).toBeUndefined();
        const [secret] = await db.source.query('SELECT server_seed FROM solo_seeds WHERE id=$1', [seed.id]);
        const digest = createHmac('sha256', secret.server_seed).update('integration:0').digest('hex');
        const keeper = zones[Number(BigInt(`0x${digest}`) % 3n)], choice = zones.find(x => x !== keeper)!;
        const input = { id: v.id, key: randomUUID(), nonce: 0, choice };
        const responses = await Promise.all(Array.from({ length: 10 }, () => solo.action(u.id, input)));
        expect(responses.every(r => r.nonce === 1 && r.goals === 1)).toBe(true);
        const cash = { id: v.id, key: randomUUID(), nonce: 1 };
        const payouts = await Promise.all(Array.from({ length: 10 }, () => solo.action(u.id, cash, true)));
        expect(payouts.every(r => r.status === 'CASHED_OUT' && r.payout === 1485)).toBe(true);
        expect(await balance(`user:${u.id}`)).toBe(100485n);
        expect(await balance(`solo:${v.id}`)).toBe(0n);
        expect(await sha256(payouts[0].serverSeed)).toBe(seed.hash);
        await expect(solo.action(u.id, { ...input, key: randomUUID() })).rejects.toThrow('Stale');
    });
    it('loses only the stake when the keeper saves and reveals the retired seed', async () => {
        const u = await identity.create(), seed = await solo.seed(u.id), v = await solo.start(u.id, { stake: 500, seedId: seed.id, clientSeed: 'save', key: randomUUID() });
        const [secret] = await db.source.query('SELECT server_seed FROM solo_seeds WHERE id=$1', [seed.id]);
        const d = createHmac('sha256', secret.server_seed).update('save:0').digest('hex'), choice = zones[Number(BigInt(`0x${d}`) % 3n)];
        const end = await solo.action(u.id, { id: v.id, key: randomUUID(), nonce: 0, choice });
        expect(end.status).toBe('LOST');
        expect(await balance(`user:${u.id}`)).toBe(99500n);
        expect(await balance(`solo:${v.id}`)).toBe(0n);
        expect(await sha256(end.serverSeed)).toBe(seed.hash);
        await expect(solo.start(u.id, { stake: 500, seedId: seed.id, clientSeed: 'again', key: randomUUID() })).rejects.toThrow('fresh seed');
    });
});
