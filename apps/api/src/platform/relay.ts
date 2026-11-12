import { Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { Database } from '../database/db';
import { platformMode } from '../platform-config';
import { errorDetails } from './diagnostics';
import { assertPlatformEvent, type PlatformTopic } from './events';
import { KafkaTransport } from './kafka';

@Injectable()
export class PlatformRelay implements OnApplicationBootstrap, BeforeApplicationShutdown {
    private timer?: NodeJS.Timeout;
    private pending?: Promise<void>;
    private stopping = false;
    private retryAt = 0;

    constructor(private db: Database, private kafka: KafkaTransport) {}

    onApplicationBootstrap() {
        if (platformMode()) this.timer = setInterval(() => {
            if (!this.stopping && !this.pending && Date.now() >= this.retryAt && this.db.ready) {
                this.pending = this.flush().finally(() => { this.pending = undefined; });
            }
        }, 250);
    }

    private async flush() {
        try {
            for (let i = 0; i < 20 && !this.stopping; i++) {
                if (!await this.publishNext()) break;
            }
        } catch (error) {
            this.retryAt = Date.now() + 2000;
            console.warn(JSON.stringify({ event: 'platform.outbox.retry', ...errorDetails(error) }));
        }
    }

    async publishNext() {
        return this.db.tx(async tx => {
            const [row]: { id: string; topic: PlatformTopic; aggregate_key: string; payload: unknown }[] = await tx.query(`
                SELECT candidate.id, candidate.topic, candidate.aggregate_key, candidate.payload
                FROM platform_outbox candidate
                WHERE candidate.published_at IS NULL
                    AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= now())
                    AND NOT EXISTS (
                    SELECT 1 FROM platform_outbox earlier
                    WHERE earlier.published_at IS NULL AND earlier.sequence < candidate.sequence
                        AND earlier.topic = candidate.topic AND earlier.aggregate_key = candidate.aggregate_key
                )
                ORDER BY candidate.sequence LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED
            `);
            if (!row) return false;
            const { id, topic, aggregate_key: key, payload } = row;
            try {
                assertPlatformEvent(topic, payload);
                if (payload.id !== id) throw new Error('Platform outbox event ID mismatch');
                await this.kafka.publish(topic, key, payload);
            } catch (error) {
                await tx.query("UPDATE platform_outbox SET next_attempt_at=now()+interval '30 seconds' WHERE id=$1", [id]);
                console.warn(JSON.stringify({ event: 'platform.outbox.delivery_retry', id, topic, ...errorDetails(error) }));
                return true;
            }
            await tx.query('UPDATE platform_outbox SET published_at=now() WHERE id=$1', [id]);
            return true;
        });
    }

    async beforeApplicationShutdown() {
        this.stopping = true;
        clearInterval(this.timer);
        await this.pending;
    }
}
