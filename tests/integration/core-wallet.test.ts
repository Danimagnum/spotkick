import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, scryptSync } from 'node:crypto';
import { commitment, type Zone } from '@spotkick/shared';
import { Database, makeDataSource } from '../../apps/api/src/database/db';
import { Identity } from '../../apps/api/src/identity';
import { MatchEngine, type MatchState } from '../../apps/api/src/matches/engine';
import { RedisService } from '../../apps/api/src/redis';
import { CoreClient } from '../../apps/api/src/wallet/core-client';
import { Ledger } from '../../apps/api/src/wallet/ledger';

function isolated(name: string) {
    const url = process.env[name];
    if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error(name + ' must point to an isolated _test database');
    return url;
}

describe.skipIf(process.env.SPOTKICK_CORE_E2E !== '1')('SpotKick with live Platform Core', () => {
    let db: Database, coreDb: ReturnType<typeof makeDataSource>, redis: RedisService;
    let core: CoreClient, engine: MatchEngine, identity: Identity;
    const players: Awaited<ReturnType<Identity['auth']>>[] = [];

    async function post(path: string, body: object, token?: string) {
        const response = await fetch(new URL(path, process.env.CORE_URL), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(path + ' returned ' + response.status + ' ' + data.code);
        return data;
    }

    beforeAll(async () => {
        isolated('DATABASE_URL');
        coreDb = await makeDataSource(isolated('SPOTKICK_CORE_TEST_DATABASE_URL')).initialize();
        db = new Database();
        await db.onModuleInit();
        redis = new RedisService();
        await redis.client.ping();
        const client = 'spotkick-test-' + randomUUID();
        const secret = randomUUID();
        const salt = randomUUID();
        const hash = 'scrypt:' + salt + ':' + scryptSync(secret, salt, 64).toString('hex');
        await coreDb.query("INSERT INTO service_clients(id,secret_hash,scopes) VALUES($1,$2,ARRAY['spotkick:matches'])", [client, hash]);
        process.env.CORE_CLIENT_ID = client;
        process.env.CORE_CLIENT_SECRET = secret;
        process.env.RESULT_MS = '0';
        core = new CoreClient();
        const ledger = new Ledger();
        identity = new Identity(db, ledger, core);
        engine = new MatchEngine(db, ledger, identity, redis);
        await coreDb.query("INSERT INTO accounts(kind,currency,allow_negative) VALUES('house','EUR',true),('escrow','EUR',false),('rake','EUR',false) ON CONFLICT DO NOTHING");
        for (let i = 0; i < 2; i++) {
            const login = { email: randomUUID() + '@spotkick.test', password: 'Local-test-password-123' };
            const user = await post('/v1/auth/register', { ...login, displayName: 'Test Player ' + i });
            await coreDb.query("UPDATE users SET kyc_status='verified' WHERE id=$1", [user.id]);
            await coreDb.query("INSERT INTO service_wallet_grants(client_id,account_id,can_write) SELECT $1,id,true FROM accounts WHERE user_id=$2 AND kind='user_cash' AND currency='EUR'", [client, user.id]);
            const { token } = await core.login(login);
            await post('/v1/testing/deposit', { amount: '5000', currency: 'EUR' }, token);
            players.push(await identity.auth(token));
        }
    });

    afterAll(async () => {
        await redis?.onApplicationShutdown();
        await db?.onApplicationShutdown();
        await coreDb?.destroy();
    });

    async function start() {
        for (const player of players) await engine.queue(player.id, 1000);
        await engine.matchmake();
        const [row] = await db.source.query('SELECT active_game FROM users WHERE id=$1', [players[0].id]);
        expect(row.active_game).toMatch(/^match:/);
        return row.active_game.slice(6) as string;
    }

    async function retry(id: string) {
        await db.source.query("UPDATE matches SET state=jsonb_set(state,'{deadline}','0') WHERE id=$1", [id]);
        await engine.tick();
    }

    async function available() {
        return Promise.all(players.map(async player => (await core.wallet(player.id)).available));
    }

    it('replays lost replies, settles the winner once, refunds cancellation and rolls back rejected pairing', async () => {
        const match = core.match.bind(core);
        const lost = new Set(['reserve', 'settle']);
        core.match = async (...args) => {
            const result = await match(...args);
            if (lost.delete(args[1])) throw new Error('Simulated lost response after Core commit');
            return result;
        };
        const id = await start();
        await engine.tick();
        expect((await engine.get(id, players[0].id)).phase).toBe('MATCHED');
        expect(await available()).toEqual(['4000', '4000']);
        await retry(id);
        expect((await engine.get(id, players[0].id)).phase).toBe('ROUND_1_COMMIT');
        const [row] = await db.source.query('SELECT state FROM matches WHERE id=$1', [id]);
        const [a, b] = (row.state as MatchState).players;
        for (let exchange = 0; exchange < 6; exchange++) {
            const choices: Zone[] = exchange % 2 === 0 ? ['left', 'right'] : ['left', 'left'];
            const salt = 'a'.repeat(64);
            for (const [i, player] of [a, b].entries())
                await engine.command(id, player.id, exchange, 'commit', await commitment(id, exchange, player.id, choices[i], salt));
            for (const [i, player] of [a, b].entries())
                await engine.command(id, player.id, exchange, 'reveal', { choice: choices[i], salt });
            const view = await engine.get(id, a.id);
            if (view.winner) break;
            await engine.tick();
        }
        expect((await engine.get(id, a.id)).phase).toBe('RESOLVED');
        await engine.tick();
        expect((await engine.get(id, a.id)).phase).toBe('RESOLVED');
        await retry(id);
        expect(await engine.get(id, a.id)).toMatchObject({ phase: 'SETTLED', winner: a.id, payout: 1940 });
        const result = await available();
        expect(result[players.findIndex(p => p.id === a.id)]).toBe('5940');
        expect(result[players.findIndex(p => p.id === b.id)]).toBe('4000');
        const [book] = await coreDb.query(
            "SELECT SUM(amount)::text AS net FROM ledger_entries");
        expect(book.net).toBe('0');
        const [rake] = await coreDb.query(
            `SELECT SUM(e.amount)::text AS amount FROM ledger_entries e
             JOIN ledger_transactions t ON t.id=e.transaction_id JOIN accounts a ON a.id=e.account_id
             WHERE t.reference=$1 AND t.operation='spotkick:rake' AND a.kind='rake'`,
            ['spotkick-match:' + id],
        );
        expect(rake.amount).toBe('60');
        expect(await coreDb.query("SELECT status FROM holds WHERE reference=$1", ['spotkick-match:' + id])).toEqual([
            { status: 'captured' }, { status: 'captured' },
        ]);

        const cancelled = await start();
        await engine.tick();
        await engine.abandon(cancelled);
        await engine.tick();
        expect((await engine.get(cancelled, a.id)).phase).toBe('ABANDONED');
        expect(await available()).toEqual(result);

        const excluded = players.map(player => player.id).sort()[1];
        await coreDb.query("UPDATE rg_profiles SET permanently_excluded=true WHERE user_id=$1", [excluded]);
        const rejected = await start();
        await engine.tick();
        expect((await engine.get(rejected, a.id)).phase).toBe('ABANDONED');
        expect(await available()).toEqual(result);
        expect(await coreDb.query("SELECT id FROM holds WHERE reference=$1", ['spotkick-match:' + rejected])).toEqual([]);
    });
});
