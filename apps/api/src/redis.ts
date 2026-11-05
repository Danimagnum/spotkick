import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
@Injectable()
export class RedisService implements OnModuleDestroy {
    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
    constructor() { this.client.on('error', e => console.error(JSON.stringify({ level: 'error', service: 'redis', message: e.message }))); }
    async onModuleDestroy() { this.client.disconnect(); }
}
