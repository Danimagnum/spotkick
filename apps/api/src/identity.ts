import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { Database } from './database/db';
import { Ledger } from './wallet/ledger';
const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
@Injectable()
export class Identity {
  constructor(private db: Database, private ledger: Ledger) {}
  async create(bot = false, manager?: EntityManager): Promise<{id:string;name:string;token:string;bot:boolean}> {
    const work = async (m: EntityManager) => {
      const id = randomUUID(), token = randomBytes(32).toString('hex');
      const name = `${bot ? 'Keeper' : 'Striker'} ${id.slice(0,4).toUpperCase()}`;
      await m.query('INSERT INTO users(id,name,token_hash,bot) VALUES($1,$2,$3,$4)',[id,name,tokenHash(token),bot]);
      await this.ledger.initialize(m); await this.ledger.account(m,`user:${id}`,'USER',id);
      await this.ledger.post(m,`welcome:${id}`,'ISSUE',id,[{account:'issuance',amount:-100_000n},{account:`user:${id}`,amount:100_000n}]);
      return {id,name,token,bot};
    };
    return manager ? work(manager) : this.db.tx(work);
  }
  async auth(token?: string) {
    if(!token || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Guest session required');
    const [user] = await this.db.source.query('SELECT id,name,bot,active_game,queue_stake FROM users WHERE token_hash=$1 AND bot=false',[tokenHash(token)]);
    if(!user) throw new UnauthorizedException('Session not found'); return user as {id:string;name:string;bot:boolean;active_game:string|null;queue_stake:number|null};
  }
}
