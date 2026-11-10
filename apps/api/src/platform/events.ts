import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { serviceName } from '../platform-config';
import started from './schemas/spotkick.match.started.v1.json';
import settled from './schemas/spotkick.match.settled.v1.json';
import health from './schemas/system.health.reported.v1.json';

const schemas = {
    'spotkick.match.started.v1': started,
    'spotkick.match.settled.v1': settled,
    'system.health.reported.v1': health,
};
export type PlatformTopic = keyof typeof schemas;
type Payload = {
    'spotkick.match.started.v1': { matchId: string; participantIds: string[] };
    'spotkick.match.settled.v1': { matchId: string; settlementId: string; result: 'win' | 'draw' | 'cancelled'; winnerId?: string };
    'system.health.reported.v1': { service: string; status: 'healthy' | 'degraded' | 'unhealthy'; latencyP95: number; errorRate: number };
};
type PlatformEvent<T extends PlatformTopic> = {
    id: string; type: T; version: number; occurredAt: string; source: string;
    correlationId: string; userId?: string; data: Payload[T];
};

type Rule = {
    type: string; properties?: Record<string, Rule>; required?: string[];
    items?: Rule; minItems?: number; minLength?: number; maxLength?: number;
    pattern?: string; const?: string | number; enum?: string[]; minimum?: number; maximum?: number;
    format?: string;
};
const keywords = new Set(['$schema', '$id', 'description', 'type', 'properties', 'required',
    'items', 'minItems', 'minLength', 'maxLength', 'pattern', 'const', 'enum', 'minimum', 'maximum', 'format']);

// The pinned schemas use this subset. Refuse new assertions until their validation is implemented.
function matches(rule: Rule, value: unknown): boolean {
    if (Object.keys(rule).some(key => !keywords.has(key))) throw new Error('Unsupported platform schema keyword');
    if (rule.const !== undefined && value !== rule.const) return false;
    if (rule.enum && !rule.enum.some(item => item === value)) return false;
    switch (rule.type) {
        case 'object': {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
            const object = value as Record<string, unknown>;
            return (rule.required ?? []).every(key => Object.hasOwn(object, key)) &&
                Object.entries(rule.properties ?? {}).every(([key, child]) => !Object.hasOwn(object, key) || matches(child, object[key]));
        }
        case 'array':
            return Array.isArray(value) && value.length >= (rule.minItems ?? 0) &&
                value.every(item => matches(rule.items!, item));
        case 'string': {
            // The pinned UUID and date-time assertions are expressed as patterns too.
            if (rule.format && (!['uuid', 'date-time'].includes(rule.format) || !rule.pattern))
                throw new Error('Unsupported platform schema format');
            if (typeof value !== 'string') return false;
            const length = Array.from(value).length;
            return length >= (rule.minLength ?? 0) && length <= (rule.maxLength ?? Infinity) &&
                (!rule.pattern || new RegExp(rule.pattern, 'u').test(value));
        }
        case 'number':
            return typeof value === 'number' && Number.isFinite(value) &&
                value >= (rule.minimum ?? -Infinity) && value <= (rule.maximum ?? Infinity);
        default:
            throw new Error('Unsupported platform schema type');
    }
}

export function assertPlatformEvent(topic: PlatformTopic, value: unknown): asserts value is PlatformEvent<PlatformTopic> {
    if (!Object.hasOwn(schemas, topic) || !matches(schemas[topic], value))
        throw new Error(`Invalid platform event for ${topic}`);
}

export async function enqueuePlatformEvent<T extends PlatformTopic>(
    tx: EntityManager, topic: T, key: string, data: Payload[T], now = new Date(), correlationId = key,
) {
    const event: PlatformEvent<T> = {
        id: randomUUID(), type: topic, version: Number(topic.split('.').at(-1)?.slice(1)),
        occurredAt: now.toISOString(), source: serviceName(), correlationId, data,
    };
    assertPlatformEvent(topic, event);
    await tx.query('INSERT INTO platform_outbox(id,topic,aggregate_key,payload) VALUES($1,$2,$3,$4)',
        [event.id, topic, key, JSON.stringify(event)]);
    return event;
}
