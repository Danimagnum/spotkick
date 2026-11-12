import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { assertPlatformEvent, type PlatformTopic } from './events';

it.each([
    ['spotkick.match.started.v1', { matchId: 'm', participantIds: ['a', 'b'] }, { participantIds: ['a'] }],
    ['spotkick.match.settled.v1', { matchId: 'm', settlementId: 's', result: 'win', winnerId: 'a' }, { settlementId: '' }],
    ['system.health.reported.v1', { service: 'spotkick', status: 'healthy', latencyP95: 21, errorRate: 0.1 }, { errorRate: 1.01 }],
] as const)('validates %s against its pinned schema', (type, data, invalid) => {
    const event = { id: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(),
        source: 'spotkick', correlationId: 'match-1', data };
    expect(() => assertPlatformEvent(type, event)).not.toThrow();
    expect(() => assertPlatformEvent(type, { ...event, data: { ...data, ...invalid } })).toThrow();
    expect(() => assertPlatformEvent(type, { ...event, version: 2 })).toThrow();
    expect(() => assertPlatformEvent(type, { ...event, occurredAt: '2025-02-29T00:00:00Z' })).toThrow();
    expect(() => assertPlatformEvent(type, { ...event, correlationId: 'x'.repeat(129) })).toThrow();
});

it('rejects unregistered topics', () => {
    expect(() => assertPlatformEvent('constructor' as PlatformTopic, {})).toThrow();
});
