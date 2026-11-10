import 'reflect-metadata';
import { Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, EntitySchema, EntityManager } from 'typeorm';
import { Initial1700000000000 } from './migrations/1700000000000-Initial';
import { LedgerSealing1700000000001 } from './migrations/1700000000001-LedgerSealing';
import { CorePlayers1700000000002 } from './migrations/1700000000002-CorePlayers';
import { PlatformOutbox1700000000003 } from './migrations/1700000000003-PlatformOutbox';
import { platformMode } from '../platform-config';
export const UserEntity = new EntitySchema({ name: 'User', tableName: 'users', columns: { id: { type: 'uuid', primary: true }, name: { type: String }, token_hash: { type: String }, bot: { type: Boolean }, active_game: { type: String, nullable: true }, queue_stake: { type: Number, nullable: true }, queued_at: { type: 'bigint', nullable: true }, created_at: { type: 'timestamptz' } } });
export const AccountEntity = new EntitySchema({ name: 'Account', tableName: 'accounts', columns: { id: { type: String, primary: true }, kind: { type: String }, owner_id: { type: 'uuid', nullable: true }, created_at: { type: 'timestamptz' } } });
export function makeDataSource(url = process.env.DATABASE_URL || 'postgres://spotkick:spotkick@localhost:5432/spotkick') { return new DataSource({ type: 'postgres', url, entities: [UserEntity, AccountEntity], migrations: [Initial1700000000000, LedgerSealing1700000000001, CorePlayers1700000000002, PlatformOutbox1700000000003], synchronize: false, extra: { max: 20, ...(platformMode() ? { connectionTimeoutMillis: 4000 } : {}) } }); }
@Injectable()
export class Database implements OnModuleInit, OnApplicationShutdown {
    source = makeDataSource();
    ready = false;
    private stopping = false;
    private retry?: NodeJS.Timeout;
    private initializing?: Promise<void>;

    async onModuleInit() {
        if (platformMode()) this.startInitialization();
        else await this.initialize();
    }

    private startInitialization() {
        if (this.stopping) return;
        this.initializing = this.initialize().catch(async () => {
            console.warn(JSON.stringify({ event: 'database.initialization_retry' }));
            if (this.source.isInitialized) await this.source.destroy().catch(() => {});
            if (!this.stopping) this.retry = setTimeout(() => this.startInitialization(), 2000);
        });
    }

    private async initialize() {
        await this.source.initialize();
        const runner = this.source.createQueryRunner();
        try {
            await runner.connect();
            await runner.query('SELECT pg_advisory_lock(481590)');
            try {
                await this.source.runMigrations();
            } finally {
                await runner.query('SELECT pg_advisory_unlock(481590)');
            }
        } finally {
            await runner.release();
        }
        this.ready = true;
    }

    async onApplicationShutdown() {
        this.stopping = true;
        clearTimeout(this.retry);
        await this.initializing;
        this.ready = false;
        if (this.source.isInitialized) await this.source.destroy();
    }
    tx<T>(fn: (m: EntityManager) => Promise<T>) { return this.source.transaction(fn); }
}
export async function event(m: EntityManager, topic: string, payload: unknown) { await m.query('INSERT INTO outbox_events(topic,payload) VALUES($1,$2)', [topic, JSON.stringify(payload)]); }
