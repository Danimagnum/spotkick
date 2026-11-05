import { z } from 'zod';
export const zones = ['left', 'centre', 'right'] as const;
export const zoneSchema = z.enum(zones);
export type Zone = z.infer<typeof zoneSchema>;
export const stakeSchema = z.number().int().min(100).max(100000);
export const queueSchema = z.object({ stake: stakeSchema });
export const commitSchema = z.object({ matchId: z.string().uuid(), exchange: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/) });
export const revealSchema = z.object({ matchId: z.string().uuid(), exchange: z.number().int().nonnegative(), choice: zoneSchema, salt: z.string().regex(/^[a-f0-9]{64}$/) });
export const soloStartSchema = z.object({ stake: stakeSchema, seedId: z.string().uuid(), clientSeed: z.string().min(1).max(128), key: z.string().uuid() });
export const soloActionSchema = z.object({ id: z.string().uuid(), key: z.string().uuid(), nonce: z.number().int().nonnegative(), choice: zoneSchema.optional() });
export type MatchPhase = 'QUEUED' | 'MATCHED' | 'STAKES_LOCKED' | `ROUND_${number}_COMMIT` | `ROUND_${number}_REVEAL` | 'RESOLVED' | 'SETTLED' | 'ABANDONED';
export interface Player {
    id: string;
    name: string;
    bot: boolean;
}
export interface ExchangeResult {
    index: number;
    round: number;
    shooter: number;
    shot: Zone;
    keeper: Zone;
    goal: boolean;
    points: number;
    timeouts: string[];
}
export interface MatchView {
    id: string;
    phase: MatchPhase;
    version: number;
    players: Player[];
    stake: number;
    pot: number;
    rakeBps: number;
    exchange: number;
    round: number;
    shooter: number;
    score: [
        number,
        number
    ];
    deadline: number;
    committed: string[];
    commitments: Record<string, string>;
    revealed: string[];
    results: ExchangeResult[];
    winner?: string;
    payout?: number;
    timeoutSeedHash: string;
    timeoutSeed?: string;
}
export interface LobbyView {
    online: Player[];
    matches: number;
    recent: {
        id: string;
        winner: string;
        payout: number;
        score: number[];
    }[];
    config: {
        rakeBps: number;
        botAfterMs: number;
        choiceMs: number;
    };
}
export interface SoloView {
    id: string;
    stake: number;
    clientSeed: string;
    serverSeedHash: string;
    serverSeed?: string;
    nonce: number;
    goals: number;
    payout: number;
    status: 'ACTIVE' | 'LOST' | 'CASHED_OUT';
    history: {
        nonce: number;
        shot: Zone;
        keeper: Zone;
        goal: boolean;
    }[];
}
export const roundOf = (exchange: number) => Math.floor(exchange / 2) + 1;
export const pointsFor = (round: number) => round <= 3 ? round : 1;
export const isGoal = (shot: Zone, keeper: Zone) => shot !== keeper;
export function winnerAfter(score: [
    number,
    number
], completedExchange: number): 0 | 1 | null {
    if (completedExchange < 5 || completedExchange % 2 === 0 || score[0] === score[1])
        return null;
    return score[0] > score[1] ? 0 : 1;
}
export function pvpPayout(stake: number, rakeBps = 300) {
    if (!Number.isSafeInteger(stake) || stake <= 0 || !Number.isInteger(rakeBps) || rakeBps < 0 || rakeBps > 10000)
        throw new Error('Invalid payout inputs');
    const pot = BigInt(stake) * 2n;
    const rake = pot * BigInt(rakeBps) / 10000n;
    return { pot: Number(pot), rake: Number(rake), payout: Number(pot - rake) };
}
export function soloPayout(stake: number, goals: number) {
    if (!Number.isSafeInteger(stake) || stake <= 0 || !Number.isInteger(goals) || goals < 1 || goals > 64)
        throw new Error('Invalid solo payout inputs');
    const n = BigInt(stake) * 99n * 3n ** BigInt(goals) / (100n * 2n ** BigInt(goals));
    if (n > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error('Payout capacity exceeded');
    return Number(n);
}
export function phaseFor(exchange: number, reveal = false): MatchPhase { return `ROUND_${roundOf(exchange)}_${reveal ? 'REVEAL' : 'COMMIT'}`; }
export function assertTransition(from: MatchPhase, to: MatchPhase) {
    const allowed = from === 'QUEUED' ? to === 'MATCHED' : from === 'MATCHED' ? to === 'STAKES_LOCKED' || to === 'ABANDONED' : from === 'STAKES_LOCKED' ? to === 'ROUND_1_COMMIT' || to === 'ABANDONED' : from.endsWith('_COMMIT') ? to === from.replace('_COMMIT', '_REVEAL') || to === 'ABANDONED' : from.endsWith('_REVEAL') ? to === 'RESOLVED' || to === 'ABANDONED' : from === 'RESOLVED' ? to === 'SETTLED' || to.endsWith('_COMMIT') || to === 'ABANDONED' : false;
    if (!allowed)
        throw new Error(`Illegal transition ${from} -> ${to}`);
}
const bytes = (s: string) => new TextEncoder().encode(s);
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), n => n.toString(16).padStart(2, '0')).join('');
export async function sha256(value: string) { return hex(await crypto.subtle.digest('SHA-256', bytes(value))); }
export function commitmentPayload(matchId: string, exchange: number, playerId: string, choice: Zone, salt: string) { return JSON.stringify([matchId, roundOf(exchange), exchange, playerId, choice, salt]); }
export async function commitment(matchId: string, exchange: number, playerId: string, choice: Zone, salt: string) { return sha256(commitmentPayload(matchId, exchange, playerId, choice, salt)); }
export async function hmac256(serverSeed: string, message: string) {
    const key = await crypto.subtle.importKey('raw', bytes(serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, bytes(message)));
}
// Rejection sampling avoids modulo bias. A retry is needed only for an all-ff digest.
export async function fairZone(serverSeed: string, clientSeed: string, nonce: number): Promise<Zone> {
    const base = `${clientSeed}:${nonce}`;
    for (let attempt = 0;; attempt++) {
        const digest = await hmac256(serverSeed, attempt === 0 ? base : `${base}:retry:${attempt}`);
        if (digest !== 'f'.repeat(64))
            return zones[Number(BigInt(`0x${digest}`) % 3n)];
    }
}
