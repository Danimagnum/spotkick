import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { commitment, type Zone } from '@spotkick/shared';
import { Database } from '../../apps/api/src/database/db';
import { Identity } from '../../apps/api/src/identity';
import { MatchEngine, type MatchState } from '../../apps/api/src/matches/engine';
import { enqueuePlatformEvent } from '../../apps/api/src/platform/events';
import { KafkaTransport } from '../../apps/api/src/platform/kafka';
import { PlatformRelay } from '../../apps/api/src/platform/relay';
import { RedisService } from '../../apps/api/src/redis';
import { CoreClient } from '../../apps/api/src/wallet/core-client';
import { Ledger } from '../../apps/api/src/wallet/ledger';

type Action = 'reserve' | 'settle' | 'release';
type Reply = { status: string; holdIds?: string[]; payout?: string };
const db = new Database();
let server: Server;
let base: string;
let redis: RedisService;
let engine: MatchEngine;
let fail: { action: Action; status: number; code: string; retryAfter?: string } | undefined;
let drop: Action | undefined;
let tokenRequests = 0;
const reservations = new Map<string, { ids: string[]; state: string }>();
const written = new Map<string, { request: string; reply: Reply }>();
const calls: { id: string; action: Action; key: string; request: string }[] = [];

beforeAll(async () => {
    await db.onModuleInit();
    redis = new RedisService();
    server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/oauth/token') {
            tokenRequests++;
            res.end(JSON.stringify({ access_token: 'test-service-token', expires_in: 90 }));
            return;
        }
        const route = /^\/api\/v1\/spotkick\/matches\/([^/]+)\/(reserve|settle|release)$/.exec(req.url || '');
        if (!route || req.headers.authorization !== 'Bearer test-service-token') {
            res.writeHead(403).end(JSON.stringify({ code: 'forbidden' }));
            return;
        }
        const [, id, action] = route as unknown as [string, string, Action];
        const key = String(req.headers['idempotency-key']);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = Buffer.concat(chunks).toString();
        calls.push({ id, action, key, request });
        if (fail?.action === action) {
            if (fail.retryAfter) res.setHeader('Retry-After', fail.retryAfter);
            res.writeHead(fail.status).end(JSON.stringify({ code: fail.code }));
            return;
        }
        const previous = written.get(key);
        if (previous) {
            if (previous.request !== request) res.writeHead(409).end(JSON.stringify({ code: 'idempotency_conflict' }));
            else res.end(JSON.stringify(previous.reply));
            return;
        }
        let reply: Reply;
        if (action === 'reserve') {
            const input = JSON.parse(request);
            if (input.userIds?.length !== 2 || input.amount !== '1000') {
                res.writeHead(400).end(JSON.stringify({ code: 'validation_failed' }));
                return;
            }
            const ids = [randomUUID(), randomUUID()];
            reservations.set(id, { ids, state: 'active' });
            reply = { status: 'reserved', holdIds: ids };
        } else {
            const holds = reservations.get(id);
            if (!holds || holds.state !== 'active') {
                res.writeHead(409).end(JSON.stringify({ code: 'hold_not_active' }));
                return;
            }
            holds.state = action === 'settle' ? 'captured' : 'released';
            reply = action === 'settle' ? { status: 'settled', payout: '1940' } : { status: 'released' };
        }
        written.set(key, { request, reply });
        if (drop === action) {
            drop = undefined;
            res.destroy();
        } else res.end(JSON.stringify(reply));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing Core test address');
    base = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
    vi.stubEnv('CORE_URL', base);
    vi.stubEnv('CORE_CLIENT_ID', 'spotkick-test');
    vi.stubEnv('CORE_CLIENT_SECRET', 'test-secret');
    vi.stubEnv('PLATFORM_MODE', 'true');
    vi.stubEnv('SERVICE_NAME', 'spotkick-test');
    vi.stubEnv('RESULT_MS', '0');
    vi.stubEnv('RAKE_BPS', '300');
    const ledger = new Ledger();
    engine = new MatchEngine(db, ledger, new Identity(db, ledger, new CoreClient()), redis);
    fail = undefined;
    drop = undefined;
    tokenRequests = 0;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
    await redis?.onApplicationShutdown();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await db.onApplicationShutdown();
});

async function createMatch() {
    const players = [1, 2].map(i => ({ id: randomUUID(), name: `Player ${i}`, bot: false }));
    const id = await db.tx(async tx => {
        for (const p of players) await tx.query('INSERT INTO users(id,name,token_hash,bot,core_user) VALUES($1::uuid,$2,$1::uuid::text,false,true)', [p.id, p.name]);
        return engine.create(tx, players, 1000);
    });
    return { id, players };
}
async function state(id: string): Promise<MatchState> {
    const [row] = await db.source.query('SELECT state FROM matches WHERE id=$1', [id]);
    return row.state;
}
async function tickNow(id: string) {
    await db.source.query("UPDATE matches SET state=jsonb_set(state,'{deadline}','0') WHERE id=$1", [id]);
    await engine.tick();
}
const facts = (id: string) => db.source.query('SELECT * FROM platform_outbox WHERE aggregate_key=$1 ORDER BY sequence', [id]);

it('rolls back the outbox with the business transaction and preserves event ID on a failed delivery', async () => {
    const matchId = randomUUID();
    const topic = 'spotkick.match.started.v1';
    const data = { matchId, participantIds: [randomUUID(), randomUUID()] };
    await expect(db.tx(async tx => {
        await enqueuePlatformEvent(tx, topic, matchId, data);
        throw new Error('forced rollback');
    })).rejects.toThrow('forced rollback');
    expect(await facts(matchId)).toEqual([]);
    const event = await db.tx(tx => enqueuePlatformEvent(tx, topic, matchId, data));
    let attempted = false;
    const publish = vi.fn(async (_topic: string, key: string) => {
        if (key === matchId && !attempted) {
            attempted = true;
            throw new Error('no broker ack');
        }
    });
    const relay = new PlatformRelay(db, { publish } as unknown as KafkaTransport);
    await expect((async () => { while (await relay.publishNext()) { /* Drain any older test facts. */ } })()).rejects.toThrow('no broker ack');
    expect((await facts(matchId))[0].published_at).toBeNull();
    await expect(relay.publishNext()).resolves.toBe(true);
    expect(publish.mock.calls.filter(call => call[1] === matchId)).toEqual([[topic, matchId, event], [topic, matchId, event]]);
    expect((await facts(matchId))[0].published_at).not.toBeNull();
});

it('replays one grouped hold, preserves the winning decision during an outage and pays once', async () => {
    const { id, players } = await createMatch();
    drop = 'reserve';
    await tickNow(id);
    expect((await state(id)).core?.action).toBe('reserve');
    expect(await facts(id)).toEqual([]);
    await tickNow(id);
    expect(reservations.get(id)?.ids).toHaveLength(2);
    expect((await facts(id)).map(row => row.topic)).toEqual(['spotkick.match.started.v1']);
    for (let exchange = 0; exchange < 6; exchange++) {
        const choices: Zone[] = exchange % 2 === 0 ? ['left', 'right'] : ['left', 'left'];
        const salt = 'ab'.repeat(32);
        for (const [i, player] of players.entries()) {
            const hash = await commitment(id, exchange, player.id, choices[i], salt);
            await engine.command(id, player.id, exchange, 'commit', hash);
        }
        for (const [i, player] of players.entries())
            await engine.command(id, player.id, exchange, 'reveal', { choice: choices[i], salt });
        if (exchange < 5) await tickNow(id);
    }
    fail = { action: 'settle', status: 503, code: 'unavailable' };
    await tickNow(id);
    const pending = await state(id);
    expect(pending.phase).toBe('RESOLVED');
    expect(pending.core).toMatchObject({ action: 'settle', decidedWinnerId: players[0].id });
    expect(pending.settlementId).toBeUndefined();
    fail = undefined;
    drop = 'settle';
    await tickNow(id);
    await tickNow(id);
    const terminal = await state(id);
    expect(terminal).toMatchObject({ phase: 'SETTLED', payout: 1940, winner: players[0].id });
    expect(reservations.get(id)?.state).toBe('captured');
    expect((await facts(id))[1].payload.data).toEqual({
        matchId: id, settlementId: terminal.settlementId, result: 'win', winnerId: players[0].id,
    });
    const matchCalls = calls.filter(call => call.id === id);
    for (const action of ['reserve', 'settle'] as const) {
        const attempts = matchCalls.filter(call => call.action === action);
        expect(attempts.length).toBeGreaterThan(1);
        expect(new Set(attempts.map(call => call.key))).toEqual(new Set([`match:${id}:${action}`]));
        expect(new Set(attempts.map(call => call.request)).size).toBe(1);
    }
    expect(tokenRequests).toBe(1);
});

it.each([
    [403, 'account_restricted', 'responsible_gaming'],
    [422, 'insufficient_funds', 'insufficient_funds'],
] as const)('records a %s rejection without a hold, local debit or started fact', async (status, code, issue) => {
    const { id } = await createMatch();
    fail = { action: 'reserve', status, code };
    await tickNow(id);
    expect(await state(id)).toMatchObject({ phase: 'ABANDONED', walletIssue: issue });
    expect(reservations.has(id)).toBe(false);
    expect(written.has(`match:${id}:reserve`)).toBe(false);
    expect(await facts(id)).toEqual([]);
    expect(await db.source.query('SELECT id FROM ledger_transactions WHERE reference=$1', [id])).toEqual([]);
});

it('releases accepted holds when local confirmation fails and records only the confirmed cancellation', async () => {
    const { id } = await createMatch();
    vi.spyOn(engine, 'persist').mockRejectedValueOnce(new Error('forced local write failure'));
    await expect(tickNow(id)).rejects.toThrow('forced local write failure');
    expect(reservations.get(id)?.state).toBe('active');
    expect((await state(id)).core?.action).toBe('release');
    expect(await facts(id)).toEqual([]);
    await tickNow(id);
    const terminal = await state(id);
    expect(terminal.phase).toBe('ABANDONED');
    expect(reservations.get(id)?.state).toBe('released');
    const rows = await facts(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.data).toEqual({ matchId: id, result: 'cancelled', settlementId: terminal.settlementId });
});

it('honours Retry-After on an in-flight 409 and stops on a definitive conflict', async () => {
    const { id } = await createMatch();
    fail = { action: 'reserve', status: 409, code: 'idempotency_in_progress', retryAfter: '12' };
    const now = Date.now();
    await tickNow(id);
    expect((await state(id)).deadline).toBeGreaterThanOrEqual(now + 12_000);
    fail = { action: 'reserve', status: 409, code: 'idempotency_conflict' };
    await tickNow(id);
    expect((await state(id)).core?.failure).toEqual({ action: 'reserve', code: 'idempotency_conflict' });
    await tickNow(id);
    expect(calls.filter(call => call.id === id)).toHaveLength(2);
    expect(await facts(id)).toEqual([]);
});
