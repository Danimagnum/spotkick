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
type Health = 'healthy' | 'degraded' | 'unhealthy';
type WindowBucket = { at: number; count: number; failed: number; bins: number[]; maxima: number[] };

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
    private readonly samples = new Map<number, WindowBucket>();
    private readonly probing = new Map<string, Promise<unknown>>();
    private readiness?: { result: Promise<Health>; expires: number };
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
        const second = Math.floor(now / 1000) % 61;
        let sample = this.samples.get(second);
        if (!sample || Math.floor(sample.at / 1000) !== Math.floor(now / 1000)) {
            sample = { at: now, count: 0, failed: 0, bins: Array(buckets.length + 1).fill(0), maxima: Array(buckets.length + 1).fill(0) };
            this.samples.set(second, sample);
        }
        const index = buckets.findIndex(bucket => seconds <= bucket);
        const bin = index < 0 ? buckets.length : index;
        sample.at = now;
        sample.count++;
        if (statusCode >= 400) sample.failed++;
        sample.bins[bin]++;
        sample.maxima[bin] = Math.max(sample.maxima[bin], elapsedMs);
    }

    window(now = Date.now()) {
        const samples = Array.from(this.samples.values()).filter(sample => sample.at > now - 60_000);
        const total = samples.reduce((sum, sample) => sum + sample.count, 0);
        if (!total) return { latencyP95: 0, errorRate: 0 };
        const failed = samples.reduce((sum, sample) => sum + sample.failed, 0);
        let remaining = Math.ceil(0.95 * total);
        const bin = Array.from({ length: buckets.length + 1 }).findIndex((_, index) => {
            remaining -= samples.reduce((sum, sample) => sum + sample.bins[index], 0);
            return remaining <= 0;
        });
        return { latencyP95: Math.max(...samples.map(sample => sample.maxima[bin])), errorRate: failed / total };
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

    private dependency(name: string, check: () => Promise<unknown>) {
        let pending = this.probing.get(name);
        if (!pending) {
            pending = Promise.resolve().then(check).finally(() => this.probing.delete(name));
            this.probing.set(name, pending);
        }
        return probe(pending);
    }

    status(): Promise<Health> {
        if (this.stopping || !this.db.ready) return Promise.resolve('unhealthy');
        if (this.readiness && Date.now() < this.readiness.expires) return this.readiness.result;
        const check = { expires: Infinity, result: this.checkStatus().finally(() => { check.expires = Date.now() + 1000; }) };
        this.readiness = check;
        return check.result;
    }

    private async checkStatus(): Promise<Health> {
        const [database, redis, broker, core] = await Promise.all([
            this.dependency('database', () => this.db.source.query('SELECT 1')),
            this.dependency('redis', () => this.redis.client.ping()),
            platformMode() ? this.kafka.ready() : Promise.resolve(true),
            platformMode() ? this.dependency('core', () => this.core.checkReadiness()) : Promise.resolve(true),
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
