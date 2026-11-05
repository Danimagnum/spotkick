import { describe, it, expect } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { isGoal, pointsFor, winnerAfter, pvpPayout, soloPayout, phaseFor, assertTransition, commitment, commitmentPayload, fairZone, hmac256, sha256 } from './index';
describe('symmetric paired rounds', () => {
    it('saves matching zones and escalates goal values', () => { expect(isGoal('left', 'left')).toBe(false); expect(isGoal('centre', 'right')).toBe(true); expect([1, 2, 3, 4].map(pointsFor)).toEqual([1, 2, 3, 1]); });
    it('never decides before both players finish, including sudden death', () => { expect(winnerAfter([6, 0], 4)).toBeNull(); expect(winnerAfter([6, 5], 5)).toBe(0); expect(winnerAfter([6, 6], 5)).toBeNull(); expect(winnerAfter([7, 6], 6)).toBeNull(); expect(winnerAfter([7, 6], 7)).toBe(0); });
    it('uses integer rake and exact rational solo multipliers', () => { expect(pvpPayout(1000)).toEqual({ pot: 2000, rake: 60, payout: 1940 }); expect(soloPayout(1000, 1)).toBe(1485); expect(soloPayout(1000, 3)).toBe(3341); });
    it('rejects invalid state transitions and terminal replay', () => { expect(phaseFor(6)).toBe('ROUND_4_COMMIT'); expect(() => assertTransition('MATCHED', 'SETTLED')).toThrow(); expect(() => assertTransition('SETTLED', 'ROUND_1_COMMIT')).toThrow(); expect(() => assertTransition('ROUND_1_COMMIT', 'ROUND_1_REVEAL')).not.toThrow(); });
});
describe('independently reproducible fairness', () => {
    it('matches the Node HMAC implementation', async () => { const digest = createHmac('sha256', 'seed').update('client:0').digest('hex'); expect(await hmac256('seed', 'client:0')).toBe(digest); expect(await fairZone('seed', 'client', 0)).toBe(['left', 'centre', 'right'][Number(BigInt(`0x${digest}`) % 3n)]); expect(await sha256('seed')).toBe(createHash('sha256').update('seed').digest('hex')); });
    it('binds commitments to salt, player, match and exchange', async () => { const c = await commitment('m', 0, 'a', 'left', 'salt'); expect(c).toBe(createHash('sha256').update(commitmentPayload('m', 0, 'a', 'left', 'salt')).digest('hex')); for (const args of [['m', 0, 'a', 'right', 'salt'], ['m', 1, 'a', 'left', 'salt'], ['m', 0, 'b', 'left', 'salt'], ['n', 0, 'a', 'left', 'salt'], ['m', 0, 'a', 'left', 'other']] as const)
        expect(await commitment(args[0], args[1], args[2], args[3], args[4])).not.toBe(c); });
});
