import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { Database } from './database/db';
import { Ledger } from './wallet/ledger';
import { CoreClient } from './wallet/core-client';
const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
@Injectable()
export class Identity {
    constructor(private db: Database, private ledger: Ledger, readonly core: CoreClient = new CoreClient()) { }
    async create(bot = false, manager?: EntityManager): Promise<{
        id: string;
        name: string;
        token: string;
        bot: boolean;
    }> {
        const work = async (m: EntityManager) => {
            const id = randomUUID(), token = randomBytes(32).toString('hex');
            const name = `${bot ? 'Keeper' : 'Striker'} ${id.slice(0, 4).toUpperCase()}`;
            await m.query('INSERT INTO users(id,name,token_hash,bot) VALUES($1,$2,$3,$4)', [id, name, tokenHash(token), bot]);
            await this.ledger.initialize(m);
            await this.ledger.account(m, `user:${id}`, 'USER', id);
            await this.ledger.post(m, `welcome:${id}`, 'ISSUE', id, [{ account: 'issuance', amount: -100000n }, { account: `user:${id}`, amount: 100000n }]);
            return { id, name, token, bot };
        };
        return manager ? work(manager) : this.db.tx(work);
    }
    async auth(token?: string) {
        if (this.core.enabled) {
            const profile = await this.core.user(token);
            const [user] = await this.db.source.query(
                `INSERT INTO users(id,name,token_hash,core_user) VALUES($1,$2,$3,true)
                 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name WHERE users.core_user
                 RETURNING id,name,bot,active_game,queue_stake`,
                [profile.id, profile.displayName, 'core:' + profile.id],
            );
            if (!user) throw new UnauthorizedException('This identifier is already used by a demo account');
            return user as { id: string; name: string; bot: boolean; active_game: string | null; queue_stake: number | null };
        }
        if (!token || !/^[a-f0-9]{64}$/.test(token))
            throw new UnauthorizedException('Guest session required');
        const [user] = await this.db.source.query('SELECT id,name,bot,active_game,queue_stake FROM users WHERE token_hash=$1 AND bot=false AND core_user=false', [tokenHash(token)]);
        if (!user)
            throw new UnauthorizedException('Session not found');
        return user as {
            id: string;
            name: string;
            bot: boolean;
            active_game: string | null;
            queue_stake: number | null;
        };
    }
}
