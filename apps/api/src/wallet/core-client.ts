import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { coreEnabled } from '../platform-config';

const userId = z.string().uuid();
const claimsSchema = z.object({
    sub: userId,
    iss: z.string(),
    aud: z.union([z.string(), z.array(z.string())]),
    exp: z.number().int(),
    iat: z.number().int(),
    nbf: z.number().int().optional(),
    email: z.string().email(),
    roles: z.array(z.string()),
    kycStatus: z.enum(['not_started', 'pending', 'verified', 'rejected']),
    kind: z.literal('user').optional(),
    client_id: z.never().optional(),
});
const userSchema = z.object({ id: userId, displayName: z.string().min(1).max(80) });
const walletSchema = z.object({
    available: z.string().regex(/^\d+$/),
    movements: z.array(z.object({ amount: z.string(), operation: z.string(), created_at: z.string() })),
});
const credentials = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
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
    private access?: { token: string; refreshAt: number };
    private renewing?: Promise<string>;
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

    private async issueServiceToken() {
        const id = process.env.CORE_CLIENT_ID ?? 'spotkick';
        const secret = process.env.CORE_CLIENT_SECRET;
        if (!secret) throw new ServiceUnavailableException('Core service credentials are missing');
        const basic = Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');
        const token = credentials.parse(await this.request('/oauth/token', {
            Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded',
        }, new URLSearchParams({ grant_type: 'client_credentials', scope: 'spotkick:matches' }).toString()));
        this.access = { token: token.access_token, refreshAt: Date.now() + Math.max(1, token.expires_in - 30) * 1000 };
        return token.access_token;
    }

    private serviceToken() {
        if (this.access && Date.now() < this.access.refreshAt) return Promise.resolve(this.access.token);
        this.renewing ??= this.issueServiceToken().finally(() => { this.renewing = undefined; });
        return this.renewing;
    }

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
            const key = this.keys.get(header.kid);
            if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url')))
                throw new Error('Invalid signature');
            const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
            const now = Math.floor(Date.now() / 1000);
            const audience = process.env.CORE_AUDIENCE ?? 'platform-core';
            const issuer = process.env.CORE_ISSUER ?? new URL(process.env.CORE_URL!).origin;
            if (claims.iss !== issuer || ![claims.aud].flat().includes(audience) ||
                claims.exp <= now || claims.iat > now + 5 || (claims.nbf !== undefined && claims.nbf > now + 5))
                throw new Error('Invalid claims');
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
            return user;
        } catch (error) {
            if (error instanceof CoreRequestError && error.status >= 500)
                throw new ServiceUnavailableException('Core identity is unavailable');
            throw new UnauthorizedException('A valid Core session is required');
        }
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
            if (this.access?.token === token) this.access = undefined;
            return send(await this.serviceToken());
        }
    }

    async wallet(id: string) {
        return walletSchema.parse(await this.service('/api/v1/spotkick/users/' + userId.parse(id) + '/wallet'));
    }

    checkReadiness() { return this.request('/health/ready'); }

    async match(id: string, action: Action, body: object) {
        const matchId = userId.parse(id);
        const result = await this.service(`/api/v1/spotkick/matches/${matchId}/${action}`, body, `match:${matchId}:${action}`, matchId);
        const status = action === 'reserve' ? 'reserved' : action === 'settle' ? 'settled' : 'released';
        const payload = z.object({ status: z.literal(status), payout: z.string().regex(/^\d+$/).optional() }).safeParse(result);
        if (!payload.success || (action === 'settle' && payload.data.payout === undefined))
            throw new CoreRequestError(503, 'core_invalid_response');
        return payload.data;
    }
}
