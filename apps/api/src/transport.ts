import { Body, Controller, Get, Post, Param, Headers, Req, Catch, ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common';
import { WebSocketGateway, OnGatewayInit, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import * as Sentry from '@sentry/node';
import { z, ZodError } from 'zod';
import { queueSchema, commitSchema, revealSchema, soloStartSchema, soloActionSchema } from '@spotkick/shared';
import { Identity } from './identity';
import { Database } from './database/db';
import { Ledger } from './wallet/ledger';
import { MatchEngine } from './matches/engine';
import { SoloService } from './solo/solo';
import { RedisService } from './redis';
import { Runtime } from './runtime';
const idSchema = z.string().uuid();
export function safeError(e: unknown) { if (e instanceof ZodError)
    return 'Invalid request'; if (e instanceof HttpException)
    return e.message; if (e instanceof Error && !('code' in e) && !e.message.includes('query') && !e.stack?.includes('pg-protocol'))
    return e.message; return 'Request failed. Please retry.'; }
@Catch()
export class ErrorFilter implements ExceptionFilter {
    catch(e: unknown, host: ArgumentsHost) { if (!(e instanceof ZodError) && !(e instanceof HttpException))
        Sentry.captureException(e); host.switchToHttp().getResponse().status(e instanceof HttpException ? e.getStatus() : 400).json({ error: safeError(e) }); }
}
@Controller()
export class ApiController {
    constructor(private identity: Identity, private db: Database, private ledger: Ledger, private engine: MatchEngine, private solo: SoloService, private runtime: Runtime, private redis: RedisService) { }
    private user(auth?: string) { return this.identity.auth(auth?.replace(/^Bearer /, '')); }
    private demoOnly() {
        if (this.identity.core.enabled) throw new HttpException('Solo is available in demo mode', 403);
    }
    @Get('mode')
    mode() { return { mode: this.identity.core.enabled ? 'core' : 'demo' }; }
    @Get('health')
    async health() { await this.db.source.query('SELECT 1'); await this.redis.client.ping(); return { ok: true, service: 'spotkick' }; }
    @Post('session')
    async session(
    @Req()
    req: any, @Body() body: unknown) { const key = `spotkick:guest:${req.ip}`; const n = await this.redis.client.incr(key); if (n === 1)
        await this.redis.client.expire(key, 60); if (n > Number(process.env.GUEST_RATE_LIMIT || 30))
        throw new HttpException('Too many sessions; try again shortly', 429);
        if (this.identity.core.enabled)
            return this.identity.core.login(z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).strict().parse(body));
        return this.identity.create();
    }
    @Get('me')
    async me(
    @Headers('authorization')
    auth?: string) { const u = await this.user(auth); const balance = this.identity.core.enabled ? (await this.identity.core.wallet(u.id)).available : Number(await this.ledger.balance(this.db.source.manager, `user:${u.id}`)); return { ...u, balance }; }
    @Get('wallet')
    async wallet(
    @Headers('authorization')
    auth?: string) { const u = await this.user(auth); if (this.identity.core.enabled) return (await this.identity.core.wallet(u.id)).movements; return this.db.source.query('SELECT t.operation,e.amount::text,t.created_at FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE e.account_id=$1 ORDER BY e.id DESC LIMIT 20', [`user:${u.id}`]); }
    @Get('lobby')
    lobby() { return this.runtime.lobby(); }
    @Post('queue')
    async queue(
    @Headers('authorization')
    auth: string, 
    @Body()
    body: unknown) { const u = await this.user(auth); return this.engine.queue(u.id, queueSchema.parse(body).stake); }
    @Post('queue/cancel')
    async cancel(
    @Headers('authorization')
    auth: string) { return this.engine.cancel((await this.user(auth)).id); }
    @Get('matches/:id')
    async match(
    @Headers('authorization')
    auth: string, 
    @Param('id')
    id: string) { return this.engine.get(idSchema.parse(id), (await this.user(auth)).id); }
    @Post('matches/commit')
    async commit(
    @Headers('authorization')
    auth: string, 
    @Body()
    body: unknown) { const u = await this.user(auth), v = commitSchema.parse(body); return this.engine.command(v.matchId, u.id, v.exchange, 'commit', v.hash); }
    @Post('matches/reveal')
    async reveal(
    @Headers('authorization')
    auth: string, 
    @Body()
    body: unknown) { const u = await this.user(auth), v = revealSchema.parse(body); return this.engine.command(v.matchId, u.id, v.exchange, 'reveal', { choice: v.choice, salt: v.salt }); }
    @Post('solo/seed')
    async seed(
    @Headers('authorization')
    auth: string) { this.demoOnly(); return this.solo.seed((await this.user(auth)).id); }
    @Post('solo/start')
    async start(
    @Headers('authorization')
    auth: string, 
    @Body()
    body: unknown) { this.demoOnly(); return this.solo.start((await this.user(auth)).id, soloStartSchema.parse(body)); }
    @Post('solo/shoot')
    async shoot(
    @Headers('authorization')
    auth: string, 
    @Body()
    body: unknown) { this.demoOnly(); return this.solo.action((await this.user(auth)).id, soloActionSchema.parse(body)); }
    @Post('solo/cashout')
    async cashout(
    @Headers('authorization')
    auth: string, 
    @Body()
    body: unknown) { this.demoOnly(); return this.solo.action((await this.user(auth)).id, soloActionSchema.parse(body), true); }
    @Get('solo/:id')
    async soloGet(
    @Headers('authorization')
    auth: string, 
    @Param('id')
    id: string) { this.demoOnly(); return this.solo.get(idSchema.parse(id), (await this.user(auth)).id); }
}
@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN || 'http://localhost:3000' }, transports: ['websocket'], maxHttpBufferSize: 8192 })
export class GameGateway implements OnGatewayInit, OnGatewayConnection {
    constructor(private identity: Identity, private engine: MatchEngine, private redis: RedisService, private runtime: Runtime) { }
    afterInit(server: Server) { const pub = this.redis.client.duplicate(), sub = this.redis.client.duplicate(); server.adapter(createAdapter(pub, sub)); server.on('close', () => { pub.disconnect(); sub.disconnect(); }); this.runtime.start(server); }
    async handleConnection(socket: Socket) {
        try {
            const user = await this.identity.auth(socket.handshake.auth.token);
            await socket.join(`user:${user.id}`);
            const heartbeat = () => this.redis.client.zadd('spotkick:presence', Date.now(), user.id);
            await heartbeat();
            const handle = (name: string, fn: (v: any) => Promise<unknown>) => socket.on(name, async (data, ack) => { if (typeof ack !== 'function')
                return; try {
                const key = `spotkick:rate:${user.id}:${Math.floor(Date.now() / 1000)}`;
                const n = await this.redis.client.incr(key);
                if (n === 1)
                    await this.redis.client.expire(key, 2);
                if (n > 30)
                    throw new Error('Slow down and retry');
                if (this.identity.core.enabled) await this.identity.core.user(socket.handshake.auth.token);
                ack({ ok: true, data: await fn(data) });
            }
            catch (e) {
                ack({ ok: false, error: safeError(e) });
            } });
            handle('heartbeat', async () => { await heartbeat(); return { ok: true }; });
            handle('match:join', async (v) => { const id = idSchema.parse(v?.id); await this.engine.get(id, user.id); for (const room of socket.rooms)
                if (room.startsWith('match:') && room !== `match:${id}`)
                    await socket.leave(room); await socket.join(`match:${id}`); return this.engine.get(id, user.id); });
            handle('queue:join', async (v) => this.engine.queue(user.id, queueSchema.parse(v).stake));
            handle('queue:cancel', async () => this.engine.cancel(user.id));
            handle('choice:commit', async (v) => { const p = commitSchema.parse(v); return this.engine.command(p.matchId, user.id, p.exchange, 'commit', p.hash); });
            handle('choice:reveal', async (v) => { const p = revealSchema.parse(v); return this.engine.command(p.matchId, user.id, p.exchange, 'reveal', { choice: p.choice, salt: p.salt }); });
            socket.emit('ready', { id: user.id, activeGame: user.active_game, queuedStake: user.queue_stake });
        }
        catch {
            socket.disconnect(true);
        }
    }
}
