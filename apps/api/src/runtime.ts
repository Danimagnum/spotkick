import { Injectable, BeforeApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import { GameMetrics } from './platform/game-metrics';
import { Server } from 'socket.io';
import * as Sentry from '@sentry/node';
import { Database } from './database/db';
import { RedisService } from './redis';
import { MatchEngine, type MatchState } from './matches/engine';
import { coreEnabled, redisKey } from './platform-config';
const publicName = (id: string, name: string, core: boolean) => core ? `Player ${id.slice(0, 8)}` : name;
@Injectable()
export class Runtime implements BeforeApplicationShutdown, OnApplicationBootstrap {
    server?: Server;
    private timer?: NodeJS.Timeout;
    private busy = false;
    private stopping = false;
    private pending?: Promise<void>;
    private pulses = 0;
    constructor(private db: Database, private redis: RedisService, private engine: MatchEngine, private metrics: GameMetrics = new GameMetrics()) { }
    start(server: Server) { this.server = server; this.metrics.connections = () => server.engine?.clientsCount ?? 0; }
    onApplicationBootstrap() { this.timer = setInterval(() => {
        if (!this.pending) this.pending = this.tick().finally(() => { this.pending = undefined; });
    }, 250); }
    async lobby() {
        const now = Date.now();
        await this.redis.client.zremrangebyscore(redisKey('presence'), 0, now - 20000);
        const onlineIds = await this.redis.client.zrange(redisKey('presence'), 0, -1);
        const core = coreEnabled();
        const players: { id: string; name: string; bot: boolean }[] = onlineIds.length
            ? await this.db.source.query('SELECT id,name,bot FROM users WHERE id=ANY($1::uuid[]) AND core_user=$2', [onlineIds, core]) : [];
        const online = players.map(({ id, name, bot }) => ({ id, name: publicName(id, name, core), bot }));
        const [{ count }] = await this.db.source.query("SELECT COUNT(*)::int AS count FROM matches WHERE status NOT IN ('SETTLED','ABANDONED') AND (state ? 'core')=$1", [core]);
        const recent: { id: string; state: MatchState }[] = await this.db.source.query("SELECT id,state FROM matches WHERE status='SETTLED' AND (state ? 'core')=$1 ORDER BY updated_at DESC LIMIT 6", [core]);
        return {
            online, matches: count,
            recent: recent.flatMap(({ id, state }) => {
                const winner = state.players.find(player => player.id === state.winner);
                return winner ? [{ id, winner: publicName(winner.id, winner.name, core), payout: state.payout, score: state.score }] : [];
            }),
            config: { rakeBps: Number(process.env.RAKE_BPS || 300), botAfterMs: Number(process.env.BOT_AFTER_MS || 5000), choiceMs: Number(process.env.CHOICE_MS || 10000) },
        };
    }
    async tick() {
        if (this.busy || this.stopping || !this.server || !this.db.ready)
            return;
        this.busy = true;
        try {
            await this.engine.tick(() => this.stopping);
            if (this.stopping) return;
            if (this.pulses++ % 4 === 0) {
                await this.engine.matchmake();
                this.server.emit('lobby', await this.lobby());
            }
            await this.db.tx(async (m) => {
                const rows = await m.query('SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100');
                for (const r of rows) {
                    if (this.stopping) break;
                    if (r.topic === 'match') {
                        // Only redacted snapshots are cached; versions protect against reordered delivery.
                        await this.redis.client.eval("local old=redis.call('GET',KEYS[1]); if not old or cjson.decode(old).version < tonumber(ARGV[1]) then redis.call('SET',KEYS[1],ARGV[2],'EX',3600) end; return 1", 1, redisKey(`match:${r.payload.id}`), r.payload.version, JSON.stringify(r.payload));
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
    async beforeApplicationShutdown() {
        this.stopping = true;
        clearInterval(this.timer);
        await this.pending;
    }
}
