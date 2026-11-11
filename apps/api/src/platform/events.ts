import { randomUUID } from 'node:crypto';
import { parseEvent, type EventData, type EventOf } from '@danigil/platform-contracts';
import type { EntityManager } from 'typeorm';
import { serviceName } from '../platform-config';
export type PlatformTopic = 'spotkick.match.started.v1' | 'spotkick.match.settled.v1' | 'system.health.reported.v1';
export function assertPlatformEvent(topic: PlatformTopic, value: unknown): asserts value is EventOf<PlatformTopic> {
    parseEvent(topic, value);
}
export async function enqueuePlatformEvent<T extends PlatformTopic>(
    tx: EntityManager, topic: T, key: string, data: EventData<T>, now = new Date(), correlationId = key,
) {
    const event = parseEvent(topic, { id: randomUUID(), type: topic, version: 1,
        occurredAt: now.toISOString(), source: serviceName(), correlationId, data });
    await tx.query('INSERT INTO platform_outbox(id,topic,aggregate_key,payload) VALUES($1,$2,$3,$4)',
        [event.id, topic, key, JSON.stringify(event)]);
    return event;
}
