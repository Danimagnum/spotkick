import 'reflect-metadata';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntitySchema, EntityManager } from 'typeorm';
import { Initial1700000000000 } from './migrations/1700000000000-Initial';

export const UserEntity = new EntitySchema({ name: 'User', tableName: 'users', columns: { id: { type: 'uuid', primary: true }, name: { type: String }, token_hash: { type: String }, bot: { type: Boolean }, active_game: { type: String, nullable: true }, queue_stake: { type: Number, nullable: true }, queued_at: { type: 'bigint', nullable: true }, created_at: { type: 'timestamptz' } } });
export const AccountEntity = new EntitySchema({ name: 'Account', tableName: 'accounts', columns: { id: { type: String, primary: true }, kind: { type: String }, owner_id: { type: 'uuid', nullable: true }, created_at: { type: 'timestamptz' } } });
export function makeDataSource(url = process.env.DATABASE_URL || 'postgres://spotkick:spotkick@localhost:5432/spotkick') { return new DataSource({ type: 'postgres', url, entities: [UserEntity,AccountEntity], migrations: [Initial1700000000000], synchronize: false, extra: { max: 20 } }); }
@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  source = makeDataSource();
  async onModuleInit() {
    await this.source.initialize();const runner=this.source.createQueryRunner();await runner.connect();
    await runner.query('SELECT pg_advisory_lock(481590)');
    try {await this.source.runMigrations();} finally {await runner.query('SELECT pg_advisory_unlock(481590)');await runner.release();}
  }
  async onModuleDestroy() { if(this.source.isInitialized) await this.source.destroy(); }
  tx<T>(fn: (m: EntityManager) => Promise<T>) { return this.source.transaction(fn); }
}
export async function event(m: EntityManager, topic: string, payload: unknown) { await m.query('INSERT INTO outbox_events(topic,payload) VALUES($1,$2)', [topic, JSON.stringify(payload)]); }
