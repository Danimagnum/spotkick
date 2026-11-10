import { Controller, Get, Header, Injectable, ServiceUnavailableException, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Database } from '../database/db';
import { platformMode, serviceName } from '../platform-config';
import { RedisService } from '../redis';
import { CoreClient } from '../wallet/core-client';
import { enqueuePlatformEvent } from './events';
import { KafkaTransport } from './kafka';

const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const probePaths = new Set(['/health', '/health/live', '/health/ready', '/metrics']);

async function probe(operation: Promise<unknown>): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            operation.then(() => true, () => false),
            new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2500); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

@Injectable()
export class Operations implements OnApplicationBootstrap, BeforeApplicationShutdown {
    private readonly statuses = new Map<number, number>();
    private readonly histogram = buckets.map(() => 0);
    private duration = 0;
    private count = 0;
    private samples: { at: number; ms: number; failed: boolean }[] = [];
    private timer?: NodeJS.Timeout;
    private pending?: Promise<void>;
    private stopping = false;

    constructor(private db: Database, private redis: RedisService, private kafka: KafkaTransport, private core: CoreClient) {}

    onApplicationBootstrap() {
        if (platformMode()) this.timer = setInterval(() => {
            if (this.stopping || this.pending || !this.db.ready) return;
            this.pending = this.report().catch(() => {
                console.warn(JSON.stringify({ event: 'platform.health.enqueue_failed' }));
            }).finally(() => { this.pending = undefined; });
        }, 30_000);
    }

    middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
        const path = (req.url || '').split('?')[0];
        if (probePaths.has(path)) {
            next();
            return;
        }
        const started = performance.now();
        res.once('finish', () => this.observe(res.statusCode, performance.now() - started));
        if (this.stopping || (platformMode() && !this.db.ready)) {
            res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Service not ready' }));
            return;
        }
        next();
    }

    observe(statusCode: number, elapsedMs: number, now = Date.now()) {
        this.statuses.set(statusCode, (this.statuses.get(statusCode) ?? 0) + 1);
        this.count++;
        const seconds = elapsedMs / 1000;
        this.duration += seconds;
        buckets.forEach((bucket, index) => { if (seconds <= bucket) this.histogram[index]++; });
        this.prune(now);
        this.samples.push({ at: now, ms: elapsedMs, failed: statusCode >= 400 });
    }

    private prune(now: number) {
        const oldest = now - 60_000;
        if (this.samples[0]?.at <= oldest) {
            const first = this.samples.findIndex(sample => sample.at > oldest);
            this.samples = first === -1 ? [] : this.samples.slice(first);
        }
    }

    window(now = Date.now()) {
        this.prune(now);
        if (!this.samples.length) return { latencyP95: 0, errorRate: 0 };
        const latencies = this.samples.map(sample => sample.ms).sort((a, b) => a - b);
        return {
            latencyP95: latencies[Math.ceil(0.95 * latencies.length) - 1],
            errorRate: this.samples.filter(sample => sample.failed).length / latencies.length,
        };
    }

    metrics() {
        return [
            '# TYPE http_requests_total counter',
            ...Array.from(this.statuses, ([code, total]) => `http_requests_total{status_code="${code}"} ${total}`),
            '# TYPE http_request_duration_seconds histogram',
            ...buckets.map((bucket, index) => `http_request_duration_seconds_bucket{le="${bucket}"} ${this.histogram[index]}`),
            `http_request_duration_seconds_bucket{le="+Inf"} ${this.count}`,
            `http_request_duration_seconds_count ${this.count}`,
            `http_request_duration_seconds_sum ${this.duration}`,
            '',
        ].join('\n');
    }

    async status(): Promise<'healthy' | 'degraded' | 'unhealthy'> {
        if (this.stopping || !this.db.ready) return 'unhealthy';
        const [database, redis, broker, core] = await Promise.all([
            probe(this.db.source.query('SELECT 1')),
            probe(this.redis.client.ping()),
            platformMode() ? this.kafka.ready() : Promise.resolve(true),
            platformMode() ? probe(this.core.checkReadiness()) : Promise.resolve(true),
        ]);
        if (!database || !redis) return 'unhealthy';
        return broker && core ? 'healthy' : 'degraded';
    }

    private async report() {
        const status = await this.status();
        if (this.stopping) return;
        const now = new Date();
        const service = serviceName();
        await this.db.tx(tx => enqueuePlatformEvent(tx, 'system.health.reported.v1', service,
            { service, status, ...this.window(now.getTime()) }, now, randomUUID()));
    }

    async beforeApplicationShutdown() {
        this.stopping = true;
        clearInterval(this.timer);
        await this.pending;
    }
}

@Controller()
export class OperationsController {
    constructor(private operations: Operations) {}

    @Get('health/live')
    live() { return { status: 'alive' }; }

    @Get('health/ready')
    async ready() {
        if (await this.operations.status() !== 'healthy') throw new ServiceUnavailableException('Service not ready');
        return { status: 'ready' };
    }

    @Get('metrics')
    @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    metrics() { return this.operations.metrics(); }
}
