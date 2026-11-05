import { MigrationInterface, QueryRunner } from 'typeorm';
export class Initial1700000000000 implements MigrationInterface {
    async up(q: QueryRunner) {
        await q.query(`
    CREATE TABLE users (id uuid PRIMARY KEY, name text NOT NULL, token_hash text UNIQUE NOT NULL, bot boolean NOT NULL DEFAULT false, active_game text, queue_stake integer, queued_at bigint, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE accounts (id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('USER','ESCROW','HOUSE_RAKE','HOUSE_BANKROLL','ISSUANCE')), owner_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE ledger_transactions (id uuid PRIMARY KEY, idempotency_key text UNIQUE NOT NULL, fingerprint text NOT NULL, operation text NOT NULL, reference text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE ledger_entries (id bigserial PRIMARY KEY, transaction_id uuid NOT NULL REFERENCES ledger_transactions(id), account_id text NOT NULL REFERENCES accounts(id), amount bigint NOT NULL CHECK(amount <> 0), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX ledger_account_idx ON ledger_entries(account_id);
    CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Ledger is immutable'; END $$;
    CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER immutable_transactions BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE FUNCTION check_balanced_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE total numeric; legs integer;
    BEGIN SELECT COALESCE(SUM(amount),0),COUNT(*) INTO total,legs FROM ledger_entries WHERE transaction_id=NEW.id;
      IF total <> 0 OR legs < 2 THEN RAISE EXCEPTION 'Unbalanced ledger transaction'; END IF; RETURN NULL; END $$;
    CREATE CONSTRAINT TRIGGER balanced_transaction AFTER INSERT ON ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_balanced_transaction();
    CREATE TABLE matches (id uuid PRIMARY KEY, status text NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX active_matches_idx ON matches(status) WHERE status NOT IN ('SETTLED','ABANDONED');
    CREATE TABLE solo_seeds (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), server_seed text NOT NULL, seed_hash text NOT NULL, used boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE solo_sessions (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), start_key text UNIQUE NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX solo_owner_idx ON solo_sessions(owner_id, updated_at DESC);
    CREATE TABLE request_keys (key text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), fingerprint text NOT NULL, response jsonb NOT NULL);
    CREATE TABLE outbox_events (id bigserial PRIMARY KEY, topic text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz);
    CREATE INDEX pending_outbox_idx ON outbox_events(id) WHERE published_at IS NULL;
  `);
    }
    async down(q: QueryRunner) { await q.query(`DROP TABLE outbox_events,request_keys,solo_sessions,solo_seeds,matches,ledger_entries,ledger_transactions,accounts,users CASCADE; DROP FUNCTION check_balanced_transaction(),reject_ledger_mutation();`); }
}
