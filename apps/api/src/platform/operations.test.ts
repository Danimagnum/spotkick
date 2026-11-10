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
