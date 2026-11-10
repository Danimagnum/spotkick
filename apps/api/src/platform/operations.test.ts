import { expect, it } from 'vitest';
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
