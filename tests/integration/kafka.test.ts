import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { validateContractEvent } from '@danigil/platform-contracts/testing';
import { Database } from '../../apps/api/src/database/db';
import { enqueuePlatformEvent } from '../../apps/api/src/platform/events';
import { KafkaTransport } from '../../apps/api/src/platform/kafka';
const { Kafka } = createRequire(resolve('apps/api/package.json'))('kafkajs');
it.skipIf(!process.env.SPOTKICK_KAFKA_TEST_BROKERS)('delivers the same durable outbox identity twice through real Kafka with aggregate and correlation metadata', async () => {
    const db = new Database();
    await db.onModuleInit();
    vi.stubEnv('PLATFORM_MODE', 'true');
    vi.stubEnv('KAFKA_BROKERS', process.env.SPOTKICK_KAFKA_TEST_BROKERS!);
    const transport = new KafkaTransport();
    const kafka = new Kafka({ clientId: 'spotkick-contract-test', brokers: process.env.SPOTKICK_KAFKA_TEST_BROKERS!.split(','), logLevel: 0 });
    const admin = kafka.admin();
    const consumer = kafka.consumer({ groupId: 'spotkick-test-' + randomUUID() });
    const matchId = randomUUID();
    const topic = 'spotkick.match.started.v1';
    const received: any[] = [];
    try {
        await admin.connect();
        await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }], waitForLeaders: true });
        const event = await db.tx(tx => enqueuePlatformEvent(tx, topic, matchId, { matchId, participantIds: [randomUUID(), randomUUID()] }));
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: true });
        await consumer.run({ eachMessage: async ({ message }: any) => {
            const payload = JSON.parse(message.value.toString());
            if (payload.id === event.id) received.push({ payload: validateContractEvent(topic, payload), key: message.key.toString(),
                eventId: message.headers['event-id'].toString(), correlationId: message.headers['correlation-id'].toString() });
        } });
        const [row] = await db.source.query('SELECT payload FROM platform_outbox WHERE id=$1', [event.id]);
        await transport.publish(topic, matchId, row.payload);
        await transport.publish(topic, matchId, row.payload);
        await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 15000 });
        expect(received).toEqual(Array(2).fill({ payload: event, key: matchId, eventId: event.id, correlationId: matchId }));
        expect(await transport.ready()).toBe(true);
        await transport.onApplicationShutdown();
        await vi.waitFor(async () => expect(await transport.ready()).toBe(false), { timeout: 8000 });
    } finally {
        await Promise.allSettled([transport.onApplicationShutdown(), consumer.disconnect(), admin.disconnect()]);
        await db.onApplicationShutdown();
        vi.unstubAllEnvs();
    }
});
