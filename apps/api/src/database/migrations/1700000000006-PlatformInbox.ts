import type { MigrationInterface, QueryRunner } from 'typeorm';
export class PlatformInbox1700000000006 implements MigrationInterface {
    name = 'PlatformInbox1700000000006';
    async up(runner: QueryRunner) {
        await runner.query(`CREATE TABLE platform_inbox (
            consumer text NOT NULL, event_id uuid NOT NULL, topic text NOT NULL,
            processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(consumer,event_id))`);
    }
    async down(runner: QueryRunner) { await runner.query('DROP TABLE platform_inbox'); }
}
