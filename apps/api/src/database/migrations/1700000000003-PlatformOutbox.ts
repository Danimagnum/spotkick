import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformOutbox1700000000003 implements MigrationInterface {
    async up(q: QueryRunner) {
        await q.query(`
            CREATE TABLE platform_outbox (
                sequence bigserial PRIMARY KEY,
                id uuid NOT NULL UNIQUE,
                topic text NOT NULL,
                aggregate_key text NOT NULL,
                payload jsonb NOT NULL,
                published_at timestamptz
            );
            CREATE INDEX platform_outbox_pending ON platform_outbox(sequence) WHERE published_at IS NULL;
            CREATE UNIQUE INDEX platform_match_fact ON platform_outbox(topic, aggregate_key)
                WHERE topic IN ('spotkick.match.started.v1', 'spotkick.match.settled.v1');
        `);
    }

    async down(q: QueryRunner) {
        await q.query('DROP TABLE platform_outbox');
    }
}
