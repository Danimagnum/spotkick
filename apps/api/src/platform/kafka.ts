import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka, type Admin, type Producer } from 'kafkajs';
import { kafkaBrokers, platformMode, serviceName } from '../platform-config';
import { assertPlatformEvent, type PlatformTopic } from './events';

@Injectable()
export class KafkaTransport implements OnApplicationShutdown {
    private readonly kafka = platformMode() ? new Kafka({
        clientId: serviceName(), brokers: kafkaBrokers(), connectionTimeout: 1500,
        requestTimeout: 2000, retry: { retries: 0 },
    }) : undefined;
    private readonly producer: Producer | undefined = this.kafka?.producer();
    private readonly admin: Admin | undefined = this.kafka?.admin();
    private producerReady?: Promise<void>;
    private adminReady?: Promise<void>;
    private probe?: { expiresAt: number; result: Promise<boolean> };

    async publish(topic: PlatformTopic, key: string, payload: unknown) {
        if (!this.producer) throw new Error('Kafka is disabled');
        assertPlatformEvent(topic, payload);
        this.producerReady ??= this.producer.connect().catch(error => {
            this.producerReady = undefined;
            throw error;
        });
        await this.producerReady;
        await this.producer.send({
            topic, acks: -1, timeout: 2000,
            messages: [{ key, value: JSON.stringify(payload), headers: { 'event-id': payload.id } }],
        });
    }

    ready() {
        if (!this.admin) return Promise.resolve(true);
        if (!this.probe || this.probe.expiresAt <= Date.now()) {
            const result = this.checkBroker(this.admin);
            this.probe = { expiresAt: Date.now() + 5000, result };
        }
        return this.probe.result;
    }

    private async checkBroker(admin: Admin) {
        this.adminReady ??= admin.connect().catch(error => {
            this.adminReady = undefined;
            throw error;
        });
        try {
            await this.adminReady;
            return (await admin.describeCluster()).brokers.length > 0;
        } catch {
            return false;
        }
    }

    async onApplicationShutdown() {
        await Promise.allSettled([this.producer?.disconnect(), this.admin?.disconnect()]);
    }
}
