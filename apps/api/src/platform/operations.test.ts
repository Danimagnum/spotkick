import { expect, it, vi } from 'vitest';
import type { Database } from '../database/db';
import type { RedisService } from '../redis';
import type { CoreClient } from '../wallet/core-client';
import type { KafkaTransport } from './kafka';
import { Operations } from './operations';

it('reports the trailing minute and exposes a Prometheus histogram in seconds', () => {
    const operations = new Operations({ ready: false } as Database, {} as RedisService, {} as KafkaTransport, {} as CoreClient);
    operations.observe(500, 450, 1_000);
    operations.observe(200, 20, 2_000);
    operations.observe(404, 600, 2_500);
    expect(operations.window(61_000)).toEqual({ latencyP95: 600, errorRate: 0.5 });
    expect(operations.window(62_500)).toEqual({ latencyP95: 0, errorRate: 0 });
    expect(operations.metrics()).toContain('http_requests_total{status_code="200"} 1');
    expect(operations.metrics()).toContain('http_request_duration_seconds_bucket{le="0.5"} 2');
});

it('coalesces concurrent readiness requests and reuses fresh probe results', async () => {
    const query = vi.fn(async () => []);
    const ping = vi.fn(async () => 'PONG');
    const ready = vi.fn(async () => true);
    const checkReadiness = vi.fn(async () => ({}));
    const operations = new Operations({ ready: true, source: { query } } as unknown as Database,
        { client: { ping } } as unknown as RedisService, { ready } as unknown as KafkaTransport,
        { checkReadiness } as unknown as CoreClient);
    const checks = Array.from({ length: 100 }, () => operations.status());
    expect(await Promise.all(checks)).toEqual(Array(100).fill('healthy'));
    expect(await operations.status()).toBe('healthy');
    expect(query).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
});

it('drains a full health queue after persistence recovers and preserves observation-time metrics', async () => {
    vi.stubEnv('PLATFORM_MODE', 'true');
    vi.useFakeTimers({ toFake: ['Date'] });
    let failing = true, broker = true;
    const events: any[] = [];
    const db = { ready: true, source: { query: async () => [] }, tx: async (work: any) => {
        if (failing) throw new Error('outbox unavailable');
        return work({ query: async (_sql: string, args: any[]) => { events.push(JSON.parse(args[3])); } });
    } } as unknown as Database;
    const operations = new Operations(db, { client: { ping: async () => 'PONG' } } as unknown as RedisService,
        { ready: async () => broker } as KafkaTransport, { checkReadiness: async () => ({}) } as CoreClient);
    const report = () => (operations as unknown as { report(): Promise<void> }).report();
    try {
        operations.observe(200, 20);
        await expect(report()).rejects.toThrow('outbox unavailable');
        operations.observe(500, 900);
        for (let i = 0; i < 65; i++) {
            vi.setSystemTime(Date.now() + 2000);
            broker = !broker;
            await expect(report()).rejects.toThrow('outbox unavailable');
        }
        failing = false;
        broker = true;
        vi.setSystemTime(Date.now() + 2000);
        await report();
        expect(events).toHaveLength(64);
        expect(events[0].data).toMatchObject({ latencyP95: 20, errorRate: 0 });
        vi.setSystemTime(Date.now() + 2000);
        await report();
        expect(events.at(-1).data.status).toBe('healthy');
    } finally {
        await operations.beforeApplicationShutdown();
        vi.useRealTimers();
        vi.unstubAllEnvs();
    }
});
