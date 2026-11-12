import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
@Injectable()
export class RedisService implements OnApplicationShutdown {
    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
    private readonly connections = [this.client];

    constructor() { this.observeErrors(this.client); }

    duplicate() {
        const client = this.client.duplicate();
        this.observeErrors(client);
        this.connections.push(client);
        return client;
    }

    private observeErrors(client: Redis) {
        client.on('error', e => console.error(JSON.stringify({ level: 'error', service: 'redis', message: e.message })));
    }

    onApplicationShutdown() {
        for (const connection of this.connections) connection.disconnect();
    }
}
