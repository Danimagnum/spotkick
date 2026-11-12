import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { parseEvent } from '@danigil/platform-contracts';
import { Database } from '../../apps/api/src/database/db';
import { WalletEvents } from '../../apps/api/src/platform/wallet-events';
it('rolls back the inbox claim when the downstream notification insert fails', async () => {
    vi.stubEnv('PLATFORM_MODE', 'false');
    const db = new Database(); await db.onModuleInit();
    const walletEvents = new WalletEvents(db);
    const userId = randomUUID();
    const guard = 'inbox_guard_' + randomUUID().replaceAll('-', '');
    const message = parseEvent('core.wallet.transaction_posted.v1', { id: randomUUID(), type: 'core.wallet.transaction_posted.v1',
        version: 1, occurredAt: new Date().toISOString(), source: 'platform-core', correlationId: randomUUID(), userId,
        data: { transactionId: randomUUID(), walletId: randomUUID(), direction: 'credit', money: { amount: '25', currency: 'EUR' }, reference: randomUUID() } });
    try {
        await db.source.query('INSERT INTO users(id,name,token_hash,core_user) VALUES($1,$2,$3,true)', [userId, 'Inbox rollback', 'core:' + userId]);
        await db.source.query(`CREATE FUNCTION ${guard}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced inbox rollback'; END $$`);
        await db.source.query(`CREATE TRIGGER ${guard} BEFORE INSERT ON outbox_events FOR EACH ROW WHEN (NEW.topic='user:${userId}') EXECUTE FUNCTION ${guard}()`);
        await expect(walletEvents.processWalletEvent(message)).rejects.toThrow('forced inbox rollback');
        expect(await db.source.query('SELECT event_id FROM platform_inbox WHERE consumer=$1 AND event_id=$2', [walletEvents.groupId, message.id])).toEqual([]);
        expect(await db.source.query('SELECT id FROM outbox_events WHERE topic=$1', ['user:' + userId])).toEqual([]);
        await db.source.query(`DROP TRIGGER ${guard} ON outbox_events`);
        await walletEvents.processWalletEvent(message);
        await walletEvents.processWalletEvent(message);
        expect((await db.source.query('SELECT COUNT(*)::int AS count FROM outbox_events WHERE topic=$1', ['user:' + userId]))[0].count).toBe(1);
    } finally {
        await db.source.query(`DROP TRIGGER IF EXISTS ${guard} ON outbox_events`);
        await db.source.query(`DROP FUNCTION IF EXISTS ${guard}()`);
        await walletEvents.beforeApplicationShutdown(); await db.onApplicationShutdown(); vi.unstubAllEnvs();
    }
});
