import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { CoreClient } from './core-client';

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(kid: string, key: KeyObject, claims: object) {
    const input = `${encode({ alg: 'RS256', kid })}.${encode(claims)}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

let server: Server | undefined;
afterEach(async () => {
    vi.unstubAllEnvs();
    if (server) await new Promise<void>((resolve, reject) => server!.close(err => err ? reject(err) : resolve()));
    server = undefined;
});

it('loads the configured JWKS, follows kid rotation and rejects service tokens', async () => {
    const first = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keys = [{ ...first.publicKey.export({ format: 'jwk' }), kid: 'old', alg: 'RS256', use: 'sig' }];
    const sub = randomUUID();
    let loads = 0;
    let profileCalls = 0;
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/trusted-keys') {
            loads++;
            res.end(JSON.stringify({ keys }));
        } else if (req.url === '/v1/me') {
            profileCalls++;
            res.end(JSON.stringify({ id: sub, displayName: 'Player' }));
        } else {
            res.writeHead(404).end('{}');
        }
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const base = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('CORE_URL', base);
    vi.stubEnv('CORE_JWKS_URL', `${base}/trusted-keys`);
    vi.stubEnv('CORE_ISSUER', 'https://issuer.example');
    vi.stubEnv('CORE_AUDIENCE', 'spotkick');
    const iat = Math.floor(Date.now() / 1000);
    const claims = { sub, email: 'player@example.test', roles: [], kycStatus: 'verified',
        kind: 'user', iss: 'https://issuer.example', aud: 'spotkick', iat, exp: iat + 60 };
    const client = new CoreClient();
    const original = token('old', first.privateKey, claims);
    await expect(client.user(original)).resolves.toMatchObject({ id: sub });
    keys.push({ ...second.publicKey.export({ format: 'jwk' }), kid: 'new', alg: 'RS256', use: 'sig' });
    const rotated = token('new', second.privateKey, claims);
    await expect(Promise.all([client.user(rotated), client.user(rotated)])).resolves.toHaveLength(2);
    await expect(client.user(original)).resolves.toMatchObject({ id: sub });
    await expect(client.user(token('new', second.privateKey, { ...claims, aud: 'other' }))).rejects.toThrow('valid Core session');
    await expect(client.user(token('new', second.privateKey, { ...claims, kind: 'service', client_id: 'spotkick' }))).rejects.toThrow('valid Core session');
    await expect(client.verifyUserToken(token('new', second.privateKey, { ...claims, iat: iat + 4, nbf: iat + 4 }))).resolves.toMatchObject({ sub });
    await expect(client.verifyUserToken(token('new', second.privateKey, { ...claims, nbf: iat + 30 }))).rejects.toThrow('valid Core session');
    await expect(client.verifyUserToken(token('new', second.privateKey, { ...claims, exp: iat }))).rejects.toThrow('valid Core session');
    expect(profileCalls).toBe(4);
    expect(loads).toBe(2);
});

it.each([false, true])('refreshes a rejected service token once (second rejection: %s)', async (rejectAgain) => {
    let tokenRequests = 0;
    const requests: { token?: string; key?: string | string[]; body: string }[] = [];
    server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/oauth/token') {
            res.end(JSON.stringify({ access_token: 'token-' + ++tokenRequests, expires_in: 90 }));
            return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        requests.push({ token: req.headers.authorization, key: req.headers['idempotency-key'], body: Buffer.concat(chunks).toString() });
        if (requests.length === 1 || rejectAgain) res.writeHead(401).end(JSON.stringify({ code: 'invalid_token' }));
        else res.end(JSON.stringify({ status: 'settled', payout: '1940' }));
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    vi.stubEnv('CORE_URL', `http://127.0.0.1:${address.port}`);
    vi.stubEnv('CORE_CLIENT_SECRET', 'test-secret');
    const matchId = randomUUID();
    const body = { winnerId: randomUUID() };
    const settlement = new CoreClient().match(matchId, 'settle', body);
    if (rejectAgain) await expect(settlement).rejects.toMatchObject({ status: 401 });
    else await expect(settlement).resolves.toMatchObject({ status: 'settled' });
    expect(tokenRequests).toBe(2);
    expect(requests).toEqual(['token-1', 'token-2'].map(token => ({
        token: 'Bearer ' + token, key: `match:${matchId}:settle`, body: JSON.stringify(body),
    })));
});
