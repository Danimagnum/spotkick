import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Database } from '../../apps/api/src/database/db';
import { RedisService } from '../../apps/api/src/redis';
import { Operations } from '../../apps/api/src/platform/operations';
import { GameMetrics } from '../../apps/api/src/platform/game-metrics';
import type { KafkaTransport } from '../../apps/api/src/platform/kafka';
import type { CoreClient } from '../../apps/api/src/wallet/core-client';
import { validateContractEvent } from '@danigil/platform-contracts/testing';
const apiRequire = createRequire(resolve('apps/api/package.json'));
const webRequire = createRequire(resolve('apps/web/package.json'));
const { NestFactory } = apiRequire('@nestjs/core');
const { io } = webRequire('socket.io-client');
let app: any, base: string, db: Database, redis: RedisService;
beforeAll(async () => {
    vi.stubEnv('PLATFORM_MODE', 'false');
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/shared/tsconfig.json'], { stdio: 'inherit' });
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json'], { stdio: 'inherit' });
    app = await NestFactory.create(apiRequire('./dist/app.js').AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    await app.get(apiRequire('./dist/runtime.js').Runtime).beforeApplicationShutdown();
    db = app.get(apiRequire('./dist/database/db.js').Database); redis = app.get(apiRequire('./dist/redis.js').RedisService);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await app?.close(); });
it('serves real probes and live connection/database gauges, failing readiness for each lost dependency', async () => {
    expect((await fetch(base + '/health/live')).status).toBe(200);
    expect((await fetch(base + '/health/ready')).status).toBe(200);
    const guest = await (await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const socket = io(base, { transports: ['websocket'], auth: { token: guest.token }, reconnection: false });
    try {
        await new Promise<void>((resolve, reject) => { socket.on('ready', () => resolve()); socket.on('connect_error', reject); setTimeout(() => reject(new Error('Socket readiness timeout')), 5000).unref(); });
        const response = await fetch(base + '/metrics');
        const text = await response.text();
        expect(response.headers.get('content-type')).toContain('text/plain');
        expect(text).toContain('spotkick_socket_connections 1');
        const [row] = await db.source.query("SELECT COUNT(*)::int AS count FROM matches WHERE status NOT IN ('SETTLED','ABANDONED') AND NOT (state ? 'core')");
        expect(text).toContain('spotkick_active_matches ' + row.count);
    } finally { socket.disconnect(); }
    await vi.waitFor(async () => expect(await (await fetch(base + '/metrics')).text()).toContain('spotkick_socket_connections 0'));
    redis.client.disconnect();
    try {
        await vi.waitFor(async () => expect((await fetch(base + '/health/ready')).status).toBe(503), { timeout: 6000 });
        expect((await fetch(base + '/health/live')).status).toBe(200);
    } finally { await redis.client.connect(); }
    await vi.waitFor(async () => expect((await fetch(base + '/health/ready')).status).toBe(200), { timeout: 6000 });
    await db.source.destroy();
    try {
        await vi.waitFor(async () => expect((await fetch(base + '/health/ready')).status).toBe(503), { timeout: 6000 });
        expect((await fetch(base + '/health/live')).status).toBe(200);
        expect(await (await fetch(base + '/metrics')).text()).toContain('spotkick_active_matches NaN');
    } finally { await db.source.initialize(); }
    await vi.waitFor(async () => expect((await fetch(base + '/health/ready')).status).toBe(200), { timeout: 6000 });
});
it('writes contract health outbox facts on startup, state changes and every 30 seconds', async () => {
    vi.stubEnv('PLATFORM_MODE', 'true');
    const service = 'health-' + randomUUID();
    vi.stubEnv('SERVICE_NAME', service);
    let brokerReady = true;
    const operations = new Operations(db, redis, { ready: async () => brokerReady } as KafkaTransport,
        { checkReadiness: async () => ({}) } as CoreClient, new GameMetrics());
    const facts = async () => (await db.source.query('SELECT payload FROM platform_outbox WHERE aggregate_key=$1 ORDER BY sequence', [service])).map((r: any) => validateContractEvent('system.health.reported.v1', r.payload));
    operations.onApplicationBootstrap();
    try {
        await vi.waitFor(async () => expect((await facts()).map((e: any) => e.data.status)).toEqual(['healthy']), { timeout: 5000 });
        brokerReady = false;
        await vi.waitFor(async () => expect((await facts()).map((e: any) => e.data.status)).toEqual(['healthy', 'degraded']), { timeout: 5000 });
        brokerReady = true;
        await vi.waitFor(async () => expect((await facts()).map((e: any) => e.data.status)).toEqual(['healthy', 'degraded', 'healthy']), { timeout: 5000 });
        const before = (await facts()).length;
        await vi.waitFor(async () => expect((await facts()).length).toBe(before + 1), { timeout: 33000, interval: 250 });
    } finally { await operations.beforeApplicationShutdown(); }
});
