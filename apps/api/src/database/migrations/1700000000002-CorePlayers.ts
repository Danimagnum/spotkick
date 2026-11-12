import { MigrationInterface, QueryRunner } from 'typeorm';

export class CorePlayers1700000000002 implements MigrationInterface {
    async up(q: QueryRunner) {
        await q.query('ALTER TABLE users ADD COLUMN core_user boolean NOT NULL DEFAULT false');
    }

    async down(q: QueryRunner) {
        await q.query('ALTER TABLE users DROP COLUMN core_user');
    }
}
