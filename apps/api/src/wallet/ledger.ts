import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
export type Leg = { account: string; amount: bigint };
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class Ledger {
  async account(m: EntityManager, id: string, kind: string, owner?: string) { await m.query('INSERT INTO accounts(id,kind,owner_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id,kind,owner || null]); }
  async balance(m: EntityManager, id: string): Promise<bigint> { const [r] = await m.query('SELECT COALESCE(SUM(amount),0)::text AS balance FROM ledger_entries WHERE account_id=$1',[id]); return BigInt(r.balance); }
  async post(m: EntityManager, key: string, operation: string, reference: string, legs: Leg[]) {
    if (legs.length < 2 || legs.some(x => x.amount === 0n) || legs.reduce((s,x) => s+x.amount,0n) !== 0n || new Set(legs.map(x => x.account)).size !== legs.length) throw new Error('Invalid balanced entry');
    const hash = fingerprint({operation,reference,legs: legs.map(x => [x.account,x.amount.toString()]).sort()});
    await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`ledger:${key}`]);
    const [existing] = await m.query('SELECT fingerprint FROM ledger_transactions WHERE idempotency_key=$1',[key]);
    if (existing) { if (existing.fingerprint !== hash) throw new Error('Idempotency key reused with different operation'); return false; }
    const ids = legs.map(x => x.account).sort();
    const accounts = await m.query('SELECT id,kind FROM accounts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[ids]);
    if (accounts.length !== ids.length) throw new Error('Unknown ledger account');
    for (const leg of legs) if (leg.amount < 0 && accounts.find((a: {id:string}) => a.id===leg.account).kind !== 'ISSUANCE' && (await this.balance(m,leg.account))+leg.amount < 0n) throw new Error('Insufficient play-money balance');
    const id = randomUUID();
    await m.query('INSERT INTO ledger_transactions(id,idempotency_key,fingerprint,operation,reference) VALUES($1,$2,$3,$4,$5)',[id,key,hash,operation,reference]);
    for (const leg of legs) await m.query('INSERT INTO ledger_entries(transaction_id,account_id,amount) VALUES($1,$2,$3)',[id,leg.account,leg.amount.toString()]);
    return true;
  }
  async initialize(m: EntityManager) {
    await this.account(m,'issuance','ISSUANCE'); await this.account(m,'house:rake','HOUSE_RAKE'); await this.account(m,'house:bankroll','HOUSE_BANKROLL');
    await this.post(m,'house:initial','ISSUE','house',[{account:'issuance',amount:-1_000_000_000n},{account:'house:bankroll',amount:1_000_000_000n}]);
  }
}
