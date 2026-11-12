import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { validateWalletRequest, validateWalletResponse } from '@danigil/platform-contracts/testing';
import { coreEnabled } from '../../apps/api/src/platform-config';
afterEach(() => vi.unstubAllEnvs());
it('requires explicit opt-in even when a Core URL exists', () => {
    vi.stubEnv('CORE_URL', 'https://core.example');
    vi.stubEnv('PLATFORM_MODE', undefined);
    expect(coreEnabled()).toBe(false);
    vi.stubEnv('PLATFORM_MODE', 'false');
    expect(coreEnabled()).toBe(false);
    vi.stubEnv('PLATFORM_MODE', 'true');
    expect(coreEnabled()).toBe(true);
});
it('rejects drift in grouped wallet requests and responses using the official kit', () => {
    const input = { userIds: [randomUUID(), randomUUID()], amount: '1000', expiresAt: new Date(Date.now() + 60000).toISOString() };
    expect(validateWalletRequest('reserveMatch', input, 'match:1:reserve')).toEqual(input);
    expect(() => validateWalletRequest('reserveMatch', input)).toThrow();
    expect(() => validateWalletRequest('reserveMatch', { ...input, amount: 1000 }, 'k')).toThrow();
    expect(() => validateWalletResponse('reserveMatch', 200, { status: 'reserved', holdIds: ['a', 'b'] })).toThrow();
    expect(() => validateWalletResponse('settleMatch', 200, { status: 'settled', payout: '1940' })).toThrow();
    expect(validateWalletRequest('releaseMatch', undefined, 'k')).toBeUndefined();
    expect(() => validateWalletRequest('releaseMatch', {}, 'k')).toThrow();
});
