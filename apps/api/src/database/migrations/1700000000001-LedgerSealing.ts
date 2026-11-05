import { MigrationInterface, QueryRunner } from 'typeorm';
export class LedgerSealing1700000000001 implements MigrationInterface {
    async up(q: QueryRunner) {
        await q.query(`
    ALTER TABLE ledger_transactions ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_current_xact_id();
    CREATE FUNCTION enforce_journal_sealing() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM ledger_transactions WHERE id=NEW.transaction_id AND created_xid=pg_current_xact_id()) THEN
        RAISE EXCEPTION 'Journal transaction is sealed';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER sealed_journal BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION enforce_journal_sealing();
  `);
    }
    async down(q: QueryRunner) { await q.query('DROP TRIGGER sealed_journal ON ledger_entries; DROP FUNCTION enforce_journal_sealing(); ALTER TABLE ledger_transactions DROP COLUMN created_xid;'); }
}
