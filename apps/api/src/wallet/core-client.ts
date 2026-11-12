import { Injectable, ServiceUnavailableException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { createPublicKey, createHash, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { createAuthVerifier, createClientCredentialsProvider, WalletClient, WalletApiError, type WalletRequest, type WalletResponse } from '@danigil/platform-contracts';
import { coreEnabled } from '../platform-config';

const userId = z.string().uuid();
const userSchema = z.object({ id: userId, displayName: z.string().min(1).max(80) });
const walletSchema = z.object({
    available: z.string().regex(/^\d+$/),
    movements: z.array(z.object({ amount: z.string(), operation: z.string(), created_at: z.string() })),
});
type Action = 'reserve' | 'settle' | 'release';

export class CoreRequestError extends Error {
    constructor(readonly status: number, readonly code: string, readonly retryAfterMs = 0) {
        super(`Core request failed (${status}, ${code})`);
    }

    get retryable() {
        return this.status >= 500 || this.status === 429 || (this.status === 409 && this.code === 'idempotency_in_progress');
    }
}

@Injectable()
export class CoreClient {
    readonly enabled = coreEnabled();
    private readonly activations = new Map<string, Promise<void>>();
    private credentials?: ReturnType<typeof createClientCredentialsProvider>;
    private verifier?: ReturnType<typeof createAuthVerifier>;
    private keys = new Map<string, KeyObject>();
    private keysUntil = 0;
    private unknownKeyRefreshAt = 0;
    private refreshingKeys?: Promise<void>;

    private async request(path: string, headers: Record<string, string> = {}, body?: string) {
        const base = process.env.CORE_URL;
        if (!base) throw new ServiceUnavailableException('Core mode is disabled');
        const url = new URL(base);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('Invalid CORE_URL');
        if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
            throw new Error('CORE_URL must use HTTPS outside loopback');
        let response: Response;
        try {
            response = await fetch(new URL(path, url), {
                method: body === undefined ? 'GET' : 'POST',
                headers, body, signal: AbortSignal.timeout(4000), redirect: 'error',
            });
        } catch {
            throw new CoreRequestError(503, 'core_unavailable');
        }
        const result: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
            const code = z.object({ code: z.string().regex(/^[a-z_]{1,80}$/) }).safeParse(result);
            const header = response.headers.get('Retry-After') || '';
            const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
            throw new CoreRequestError(response.status, code.success ? code.data.code : 'unknown',
                Number.isSafeInteger(delay) ? Math.max(0, delay) : 0);
        }
        if (result === undefined) throw new CoreRequestError(503, 'core_invalid_response');
        return result;
    }

    private serviceToken(forceRefresh = false) {
        if (!process.env.CORE_CLIENT_SECRET) throw new ServiceUnavailableException('Core service credentials are missing');
        this.credentials ??= createClientCredentialsProvider({
            tokenUrl: new URL('/oauth/token', process.env.CORE_URL).href,
            clientId: process.env.CORE_CLIENT_ID ?? 'spotkick', clientSecret: process.env.CORE_CLIENT_SECRET,
            scopes: ['spotkick:matches'], fetch: this.safeFetch,
        });
        return this.credentials(forceRefresh);
    }
    private readonly safeFetch: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) ||
            (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
            throw new Error('Core URLs must use HTTPS outside loopback');
        return fetch(input, { ...init, redirect: 'error' });
    };
    async login(input: { email: string; password: string }) {
        try {
            const result = z.object({ accessToken: z.string() }).parse(await this.request('/v1/auth/login', {
                'Content-Type': 'application/json',
            }, JSON.stringify(input)));
            await this.user(result.accessToken);
            return { token: result.accessToken };
        } catch (error) {
            if (error instanceof CoreRequestError && error.status === 401)
                throw new UnauthorizedException('Email or password is incorrect');
            throw error;
        }
    }

    private refreshKeys() {
        this.refreshingKeys ??= this.loadKeys().finally(() => { this.refreshingKeys = undefined; });
        return this.refreshingKeys;
    }

    private async loadKeys() {
        const url = new URL(process.env.CORE_JWKS_URL || '/.well-known/jwks.json', process.env.CORE_URL);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('Invalid CORE_JWKS_URL');
        let response: Response;
        try {
            response = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
        } catch {
            throw new CoreRequestError(503, 'core_unavailable');
        }
        if (!response.ok) throw new CoreRequestError(503, 'jwks_unavailable');
        const jwks = z.object({ keys: z.array(z.object({
            kty: z.literal('RSA'), kid: z.string(), n: z.string(), e: z.string(),
            alg: z.literal('RS256'), use: z.literal('sig'),
        })) }).parse(await response.json());
        this.keys = new Map(jwks.keys.map(({ kid, ...jwk }) => [kid, createPublicKey({ key: jwk, format: 'jwk' })]));
        this.keysUntil = Date.now() + 60_000;
    }

    async verifyUserToken(token?: string) {
        try {
            if (!token || token.length > 8192) throw new Error('Invalid token');
            const parts = token.split('.');
            if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid token');
            const header = z.object({ alg: z.literal('RS256'), kid: z.string().min(1).max(128) }).parse(
                JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
            if (Date.now() >= this.keysUntil) {
                await this.refreshKeys();
            } else if (!this.keys.has(header.kid) && Date.now() >= this.unknownKeyRefreshAt) {
                this.unknownKeyRefreshAt = Date.now() + 5_000;
                await this.refreshKeys();
            } else if (!this.keys.has(header.kid) && this.refreshingKeys) {
                await this.refreshingKeys;
            }
            this.verifier ??= createAuthVerifier({
                issuer: process.env.CORE_ISSUER ?? new URL(process.env.CORE_URL!).origin,
                audience: process.env.CORE_AUDIENCE ?? 'platform-core',
                jwksUrl: new URL(process.env.CORE_JWKS_URL || '/.well-known/jwks.json', process.env.CORE_URL).href,
                keyResolver: async protectedHeader => {
                    const key = this.keys.get(protectedHeader.kid!);
                    if (!key) throw new Error('Unknown signing key');
                    return crypto.subtle.importKey('jwk', key.export({ format: 'jwk' }),
                        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
                },
            });
            const claims = await this.verifier.verifyUser(token);
            // The official additive schema permits extra fields; exclude machine identities explicitly.
            const raw = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            if (raw.client_id !== undefined || (raw.kind !== undefined && raw.kind !== 'user') ||
                claims.exp <= Math.floor(Date.now() / 1000) || claims.iat > Math.floor(Date.now() / 1000) + 5)
                throw new Error('Invalid user identity');
            return claims;
        } catch (error) {
            if (error instanceof CoreRequestError && error.status >= 500)
                throw new ServiceUnavailableException('Core identity is unavailable');
            throw new UnauthorizedException('A valid Core session is required');
        }
    }

    async user(token?: string) {
        const claims = await this.verifyUserToken(token);
        try {
            const user = userSchema.parse(await this.request('/v1/me', { Authorization: 'Bearer ' + token }));
            if (user.id !== claims.sub) throw new Error('Invalid subject');
            await this.activatePlayer(token!, claims.sub);
            return user;
        } catch (error) {
            if (error instanceof CoreRequestError && error.status >= 500)
                throw new ServiceUnavailableException('Core identity is unavailable');
            if (error instanceof CoreRequestError && error.status === 403)
                throw new ForbiddenException('Core wallet activation was not authorized');
            throw new UnauthorizedException('A valid Core session is required');
        }
    }

    private activatePlayer(token: string, playerId: string) {
        let pending = this.activations.get(playerId);
        if (!pending) {
            const clientId = process.env.CORE_CLIENT_ID ?? 'spotkick';
            const key = 'activate:' + createHash('sha256').update(JSON.stringify([clientId, playerId])).digest('hex');
            pending = this.request('/v1/services/' + encodeURIComponent(clientId) + '/activate', {
                Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key,
            }, '{}').then(result => {
                const grant = z.object({ serviceId: z.literal(clientId), wallets: z.array(z.object({
                    walletId: userId, currency: z.literal('EUR'), canWrite: z.literal(true),
                })).min(1) }).safeParse(result);
                if (!grant.success) throw new CoreRequestError(503, 'core_invalid_grant');
            }).catch(error => { this.activations.delete(playerId); throw error; });
            this.activations.set(playerId, pending);
        }
        return pending;
    }

    private async service(path: string, body?: object, key?: string, correlation?: string) {
        const encoded = body === undefined ? undefined : JSON.stringify(body);
        const send = (token: string) => this.request(path, {
            Authorization: 'Bearer ' + token,
            ...(key ? { 'Idempotency-Key': key, 'X-Correlation-Id': correlation!, 'Content-Type': 'application/json' } : {}),
        }, encoded);
        const token = await this.serviceToken();
        try {
            return await send(token);
        } catch (error) {
            if (!(error instanceof CoreRequestError) || error.status !== 401) throw error;
            return send(await this.serviceToken(true));
        }
    }

    async wallet(id: string) {
        return walletSchema.parse(await this.service('/api/v1/spotkick/users/' + userId.parse(id) + '/wallet'));
    }

    checkReadiness() { return this.request('/health/ready'); }

    async match(id: string, action: 'reserve', body: WalletRequest<'reserveMatch'>): Promise<WalletResponse<'reserveMatch'> | WalletResponse<'settleMatch'> | WalletResponse<'releaseMatch'>>;
    async match(id: string, action: 'settle', body: WalletRequest<'settleMatch'>): Promise<WalletResponse<'reserveMatch'> | WalletResponse<'settleMatch'> | WalletResponse<'releaseMatch'>>;
    async match(id: string, action: 'release', body?: undefined): Promise<WalletResponse<'reserveMatch'> | WalletResponse<'settleMatch'> | WalletResponse<'releaseMatch'>>;
    async match(id: string, action: Action, body: WalletRequest<'reserveMatch'> | WalletRequest<'settleMatch'> | undefined) {
        const matchId = userId.parse(id);
        let retryAfterMs = 0;
        const client = new WalletClient({
            baseUrl: new URL('/api/v1', process.env.CORE_URL).href,
            token: force => this.serviceToken(force), retries: 0, timeoutMs: 4000,
            fetch: async (input, init) => {
                const response = await this.safeFetch(input, init);
                const value = response.headers.get('retry-after');
                if (value) {
                    const seconds = Number(value);
                    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
                    if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
                }
                return response;
            },
        });
        const metadata = { idempotencyKey: 'match:' + matchId + ':' + action, correlationId: matchId };
        const send = () => action === 'reserve'
            ? client.call('reserveMatch', { matchId }, body as WalletRequest<'reserveMatch'>, metadata)
            : action === 'settle'
                ? client.call('settleMatch', { matchId }, body as WalletRequest<'settleMatch'>, metadata)
                : client.call('releaseMatch', { matchId }, undefined, metadata);
        try {
            try { return await send(); }
            catch (error) {
                if (!(error instanceof WalletApiError) || error.status !== 401) throw error;
                await this.serviceToken(true);
                return await send();
            }
        } catch (error) {
            if (error instanceof WalletApiError)
                throw new CoreRequestError(error.status || 503, error.code, retryAfterMs);
            // Invalid success responses remain ambiguous writes and must retain the command.
            throw new CoreRequestError(503, 'core_invalid_response');
        }
    }
}
