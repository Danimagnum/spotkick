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

it.skipIf(!process.env.SPOTKICK_KAFKA_TEST_BROKERS)('deduplicates real wallet events atomically with one notification and dead-letters invalid input', async () => {
    const { WalletEvents } = await import('../../apps/api/src/platform/wallet-events');
    const { ValidatedProducer, deadLetterTopic } = await import('@danigil/platform-contracts');
    const db = new Database(); await db.onModuleInit();
    vi.stubEnv('PLATFORM_MODE', 'true');
    vi.stubEnv('KAFKA_BROKERS', process.env.SPOTKICK_KAFKA_TEST_BROKERS!);
    vi.stubEnv('SERVICE_NAME', 'inbox-' + randomUUID());
    const walletEvents = new WalletEvents(db);
    const kafka = new Kafka({ clientId: 'inbox-test', brokers: process.env.SPOTKICK_KAFKA_TEST_BROKERS!.split(','), logLevel: 0 });
    const admin = kafka.admin(), producer = kafka.producer();
    const userId = randomUUID(), walletId = randomUUID();
    const topic = 'core.wallet.transaction_posted.v1' as const;
    const dlq = deadLetterTopic(topic, walletEvents.groupId);
    try {
        await db.source.query('INSERT INTO users(id,name,token_hash,core_user) VALUES($1,$2,$3,true)', [userId, 'Inbox fixture', 'core:' + userId]);
        await admin.connect(); await producer.connect();
        await admin.createTopics({ topics: [topic, dlq].map(topic => ({ topic, numPartitions: 1, replicationFactor: 1 })), waitForLeaders: true });
        walletEvents.onApplicationBootstrap();
        await vi.waitFor(() => expect(walletEvents.ready()).toBe(true), { timeout: 15000 });
        async function waitForCommitted() {
            const targets = await admin.fetchTopicOffsets(topic);
            await vi.waitFor(async () => {
                const [committed] = await admin.fetchOffsets({ groupId: walletEvents.groupId, topics: [topic] });
                for (const target of targets.filter((p: any) => Number(p.offset) > 0))
                    expect(Number(committed.partitions.find((p: any) => p.partition === target.partition)?.offset)).toBeGreaterThanOrEqual(Number(target.offset));
            }, { timeout: 15000 });
        }
        const deadLetters = async () => (await admin.fetchTopicOffsets(dlq)).reduce((n: number, p: any) => n + Number(p.offset), 0);
        await waitForCommitted();
        const initialDeadLetters = await deadLetters();
        const typed = new ValidatedProducer(producer, 'platform-core');
        const event = await typed.publish(topic, { transactionId: randomUUID(), walletId, direction: 'credit', money: { amount: '25', currency: 'EUR' }, reference: randomUUID() }, { userId, key: walletId });
        await typed.sendEvent(topic, event, walletId);
        await vi.waitFor(async () => expect((await db.source.query('SELECT COUNT(*)::int AS count FROM platform_inbox WHERE consumer=$1 AND event_id=$2', [walletEvents.groupId, event.id]))[0].count).toBe(1), { timeout: 10000 });
        await waitForCommitted();
        expect(await deadLetters()).toBe(initialDeadLetters);
        expect((await db.source.query('SELECT COUNT(*)::int AS count FROM outbox_events WHERE topic=$1', ['user:' + userId]))[0].count).toBe(1);
        expect(await db.source.query('SELECT id FROM ledger_transactions WHERE reference=$1', [event.data.reference])).toEqual([]);
        await producer.send({ topic, messages: [{ key: walletId, value: 'invalid-json' }] });
        await waitForCommitted();
        expect(await deadLetters()).toBe(initialDeadLetters + 1);
    } finally {
        await walletEvents.beforeApplicationShutdown();
        await Promise.allSettled([producer.disconnect(), admin.disconnect()]);
        await db.onApplicationShutdown(); vi.unstubAllEnvs();
    }
});
