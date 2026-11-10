import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformOutboxRetry1700000000004 implements MigrationInterface {
    async up(q: QueryRunner) {
        await q.query('ALTER TABLE platform_outbox ADD COLUMN next_attempt_at timestamptz');
    }

    async down(q: QueryRunner) {
        await q.query('ALTER TABLE platform_outbox DROP COLUMN next_attempt_at');
    }
}
