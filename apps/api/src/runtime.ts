import { Injectable, OnModuleDestroy, OnApplicationBootstrap } from '@nestjs/common';
import { Server } from 'socket.io';
import * as Sentry from '@sentry/node';
import { Database } from './database/db';
import { RedisService } from './redis';
import { MatchEngine } from './matches/engine';
@Injectable()
export class Runtime implements OnModuleDestroy, OnApplicationBootstrap {
    server?: Server;
    private timer?: NodeJS.Timeout;
    private busy = false;
    private pulses = 0;
    constructor(private db: Database, private redis: RedisService, private engine: MatchEngine) { }
    start(server: Server) { this.server = server; }
    onApplicationBootstrap() { this.timer = setInterval(() => void this.tick(), 250); }
    async lobby() {
        const now = Date.now();
        await this.redis.client.zremrangebyscore('spotkick:presence', 0, now - 20000);
        const onlineIds = await this.redis.client.zrange('spotkick:presence', 0, -1);
        const online = onlineIds.length ? await this.db.source.query('SELECT id,name,bot FROM users WHERE id=ANY($1::uuid[])', [onlineIds]) : [];
        const [{ count }] = await this.db.source.query("SELECT COUNT(*)::int AS count FROM matches WHERE status NOT IN ('SETTLED','ABANDONED')");
        const recent = await this.db.source.query("SELECT id,state FROM matches WHERE status='SETTLED' ORDER BY updated_at DESC LIMIT 6");
        return { online, matches: count, recent: recent.map((r: {
                id: string;
                state: any;
            }) => ({ id: r.id, winner: r.state.players.find((p: {
                    id: string;
                }) => p.id === r.state.winner).name, payout: r.state.payout, score: r.state.score })), config: { rakeBps: Number(process.env.RAKE_BPS || 300), botAfterMs: Number(process.env.BOT_AFTER_MS || 5000), choiceMs: Number(process.env.CHOICE_MS || 10000) } };
    }
    async tick() {
        if (this.busy || !this.server)
            return;
        this.busy = true;
        try {
            await this.engine.tick();
            if (this.pulses++ % 4 === 0) {
                await this.engine.matchmake();
                this.server.emit('lobby', await this.lobby());
            }
            await this.db.tx(async (m) => {
                const rows = await m.query('SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100');
                for (const r of rows) {
                    if (r.topic === 'match') {
                        // Only redacted snapshots are cached; versions protect against reordered delivery.
                        await this.redis.client.eval("local old=redis.call('GET',KEYS[1]); if not old or cjson.decode(old).version < tonumber(ARGV[1]) then redis.call('SET',KEYS[1],ARGV[2],'EX',3600) end; return 1", 1, `spotkick:match:${r.payload.id}`, r.payload.version, JSON.stringify(r.payload));
                        this.server!.to(`match:${r.payload.id}`).emit('match', r.payload);
                        if (r.payload.phase === 'SETTLED' || r.payload.phase === 'ABANDONED')
                            for (const p of r.payload.players)
                                this.server!.to(`user:${p.id}`).emit('account', { walletChanged: true });
                    }
                    else
                        this.server!.to(r.topic).emit('account', r.payload);
                    await m.query('UPDATE outbox_events SET published_at=now() WHERE id=$1', [r.id]);
                }
            });
        }
        catch (e) {
            Sentry.captureException(e);
            console.error(JSON.stringify({ level: 'error', service: 'runtime', message: e instanceof Error ? e.message : String(e) }));
        }
        finally {
            this.busy = false;
        }
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
}
