import { Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { ValidatedConsumer, parseEvent } from '@danigil/platform-contracts';
import { Database, event } from '../database/db';
import { kafkaBrokers, platformMode, serviceName } from '../platform-config';
const topic = 'core.wallet.transaction_posted.v1' as const;
@Injectable()
export class WalletEvents implements OnApplicationBootstrap, BeforeApplicationShutdown {
    readonly groupId = serviceName() + '-core-wallet-v1';
    private readonly kafka = platformMode() ? new Kafka({ clientId: this.groupId, brokers: kafkaBrokers(),
        connectionTimeout: 1500, requestTimeout: 2000, retry: { retries: 3, initialRetryTime: 250 } }) : undefined;
    private readonly consumer: Consumer | undefined = this.kafka?.consumer({ groupId: this.groupId });
    private readonly letters: Producer | undefined = this.kafka?.producer({ idempotent: true, maxInFlightRequests: 1 });
    private readonly validated = this.consumer && this.letters ? new ValidatedConsumer(this.consumer, this.letters, {
        groupId: this.groupId, maxAttempts: 3, retryDelayMs: 250,
    }) : undefined;
    private timer?: NodeJS.Timeout;
    private connecting?: Promise<void>;
    private running = false;
    private healthy = false;
    private stopping = false;
    constructor(private db: Database) {
        this.consumer?.on(this.consumer.events.GROUP_JOIN, () => { this.healthy = !this.stopping; });
        this.consumer?.on(this.consumer.events.CRASH, e => { this.healthy = false; this.running = e.payload.restart; });
    }
    ready() { return !this.stopping && (!this.kafka || this.healthy); }
    onApplicationBootstrap() {
        if (!this.kafka) return;
        this.kick();
        this.timer = setInterval(() => this.kick(), 1000);
    }
    private kick() {
        if (this.stopping || !this.db.ready || this.running || this.connecting) return;
        this.connecting = (async () => {
            await this.letters!.connect();
            await this.validated!.start(topic, input => this.processWalletEvent(input), true);
            this.running = true;
        })().catch(async () => {
            this.healthy = false;
            await Promise.allSettled([this.validated!.disconnect(), this.letters!.disconnect()]);
            console.warn(JSON.stringify({ event: 'platform.wallet.consumer_retry' }));
        }).finally(() => { this.connecting = undefined; });
    }
    async processWalletEvent(input: unknown) {
        const message = parseEvent(topic, input);
        await this.db.tx(async tx => {
            const inserted = await tx.query(`INSERT INTO platform_inbox(consumer,event_id,topic) VALUES($1,$2,$3)
                ON CONFLICT DO NOTHING RETURNING event_id`, [this.groupId, message.id, topic]);
            if (!inserted.length || !message.userId || message.data.money.currency !== 'EUR') return;
            const [user] = await tx.query('SELECT id FROM users WHERE id::text=$1 AND core_user=true', [message.userId]);
            if (user) await event(tx, 'user:' + user.id, { walletChanged: true });
        });
    }
    async beforeApplicationShutdown() {
        this.stopping = true; this.healthy = false;
        clearInterval(this.timer);
        await this.connecting;
        await Promise.allSettled([this.validated?.disconnect(), this.letters?.disconnect()]);
    }
}
