import type { MigrationInterface, QueryRunner } from 'typeorm';
export class DueMatches1700000000005 implements MigrationInterface {
    name = 'DueMatches1700000000005';
    async up(runner: QueryRunner) {
        await runner.query(`CREATE INDEX matches_due_idx ON matches ((state ? 'core'), ((state->>'deadline')::bigint))
            WHERE status NOT IN ('SETTLED','ABANDONED') AND NOT COALESCE((state->'core') ? 'failure',false)`);
    }
    async down(runner: QueryRunner) { await runner.query('DROP INDEX matches_due_idx'); }
}
