# Platform Core mode

SpotKick uses the demo ledger by default and starts without Kafka or Core. Set `PLATFORM_MODE=true` on a separate deployment to enable Core and Kafka for live two-player matches. Balances and journal entries then come from Core in EUR minor units. Demo bots and solo stakes are disabled.

`PLATFORM_MODE=false` or an absent flag selects standalone, even when `CORE_URL` is configured. Only `PLATFORM_MODE=true` enables Core and Kafka. Drain existing Core matches before changing modes.

## Configuration

Set `SERVICE_NAME`, `DATABASE_URL`, `REDIS_URL`, `KAFKA_BROKERS`, `CORE_URL`, `CORE_JWKS_URL`, `CORE_ISSUER`, `CORE_AUDIENCE`, `CORE_CLIENT_ID` and `CORE_CLIENT_SECRET` on the SpotKick API. The API binds to `0.0.0.0`, with `PORT` defaulting to `3000` in platform mode and `3001` in demo. Use `http://127.0.0.1:4101` for a host-run local Core API and HTTPS outside loopback. Keep client credentials server-side. Configure the issuer and audience to match Core, and set the trusted JWKS endpoint independently of the issuer.

Provision a Core client with `spotkick:matches` and write grants for both players' EUR cash wallets. Each player needs a verified Core account, available funds and responsible-gaming capacity. Users sign in with their Core credentials. The browser keeps the short-lived access token for the current tab and prompts for sign-in again when it expires.

## Match lifecycle

SpotKick persists a match ID and its pending wallet action before sending a request. Core reserves both stakes in one PostgreSQL transaction. When the game has a winner, Core captures both stakes, credits the winner and books the rake in one PostgreSQL transaction. A cancelled match releases both stakes. Holds expire after 30 minutes.

The request keys are `match:<id>:reserve`, `match:<id>:settle` and `match:<id>:release`. SpotKick retries the same key and body after a timeout, 5xx, 429 or `409 idempotency_in_progress`. It respects `Retry-After`. An eligibility or funding rejection records the reason without a local debit or a started event. If local confirmation of a successful reserve rolls back, the worker records a pending release once PostgreSQL can accept the compensation. A lost local commit response is reconciled against the persisted match phase before releasing.

The wallet client performs no in-memory money retries: the persisted match command schedules backoff and respects Retry-After across restarts. A 401 refreshes the machine token once with the same request/key. Reserve expects HTTP 201 and two hold IDs; settlement expects payout and rake. Release sends no request body. The settlementId is the stable command key `match:<id>:settle` or `match:<id>:release`, not a field invented in Core’s response.

A definitive wallet conflict leaves the command and decision available for reconciliation. Inspect the structured `core.match.reconciliation_required` log, the persisted match and the corresponding Core operation before resuming. If the holds expired while settling, SpotKick confirms their release and retains the sporting decision in the internal record. Keep Core available while active Core matches drain before changing modes.

## Platform events and operations

The API pins `@danigil/platform-contracts@0.2.0` from npm. Events use its Zod registry and `ValidatedProducer`; there are no vendored event schemas. Grouped money writes use its `WalletClient` and request/response types. JWT verification uses `createAuthVerifier` with the existing cached, trusted JWKS resolver; machine tokens use `createClientCredentialsProvider`. Match facts are stored in `platform_outbox` in the same transaction as the confirmed state. The relay sends with an aggregate key, the `event-id` header and broker acknowledgements before marking the row. Failed deliveries are scheduled for retry after 30 seconds. Earlier unpublished events block only later events with the same topic and aggregate key. Consumers deduplicate by event ID. Prepare the three topics and broker permissions before starting platform mode. SpotKick uses the broker listener advertised to the API.

- `spotkick.match.started.v1` follows confirmation of both stakes.
- `spotkick.match.settled.v1` follows a confirmed payment or refund. It includes the persisted `settlementId`. A tie in regulation continues into sudden death.
- `system.health.reported.v1` is recorded on startup, every 30 seconds and on observed state changes (one-second polling, with dependency probe caching). Pending reports survive database reconnection in a bounded in-memory queue of 64 samples; process termination before outbox insertion loses those samples. Once inserted, outbox delivery is durable. A full queue logs platform.health.queue_full and defers further observations until drained. Its HTTP latency and error rate use the trailing minute and exclude probes and metrics scrapes.

`/health` keeps its demo contract. Use `/health/live` for process liveness, `/health/ready` for dependency and migration readiness, and `/metrics` for Prometheus counters and histogram buckets. Readiness returns HTTP 503 during dependency outages and migration startup. Concurrent requests share the probes, and results are cached for one second. Health events estimate latency p95 from fixed histogram buckets over the trailing minute, with one-second resolution at the window boundary. The API can be run as UID/GID 1000 on a read-only root filesystem with `/tmp` writable.

## Migration and rollback

Migration `1700000000003-PlatformOutbox` creates a separate outbox table. Migration `1700000000004-PlatformOutboxRetry` adds the retry schedule. Before applying these migrations in any hosted environment, drain pending wallet operations and take a PostgreSQL custom-format backup:

```sh
pg_dump --format=custom --file=spotkick-before-platform.dump "$DATABASE_URL"
pg_restore --list spotkick-before-platform.dump
```

Rehearse restoration into a separate empty database using `pg_restore --exit-on-error --dbname="$RESTORE_DATABASE_URL" spotkick-before-platform.dump`. To roll back the application, stop platform workers, retain the database and outbox, and restore the previous image. If a database restore is required, confirm the intended point in time and reconcile wallet requests and Kafka deliveries since that backup before resuming. The migration's down action drops the platform outbox, so retain its rows until pending deliveries have been reconciled.

## Local integration test

With an isolated PostgreSQL database and Redis instance, run `pnpm test:integration`. The fake-Core HTTP suite verifies idempotent requests, rejected stakes, settlement recovery, compensation and the transactional event relay.

Start the Core API on loopback with test deposits enabled and an isolated database whose name ends in `_test`. Use a Core build that exposes the grouped SpotKick wallet routes. Point SpotKick to a separate `_test` database and a dedicated Redis database. Set `SPOTKICK_CORE_E2E=1`, `SPOTKICK_CORE_TEST_DATABASE_URL`, `CORE_URL` and the exact Core issuer, audience and JWKS URL, then run:

```sh
pnpm exec vitest run tests/integration/core-wallet.test.ts
```

The test provisions disposable verified users and a scoped client. A loopback HTTP proxy drops the reserve and settlement responses after Core commits, so SpotKick must recover through the real client retry path. The test checks payout, rake, balanced ledger postings, outbox facts, cancellation and a rejection with no holds or started fact.

## Contract verification (0.2.0)

`pnpm test:contract` runs the official package test kit and adapter tests. Integration tests validate actual outgoing grouped requests and stored outbox payloads; fixtures include the contract HTTP statuses and machine-token fields. `pnpm test:mutations` deliberately breaks opt-in, event validation and money idempotency and requires assertion failures before restoring each source file. Run it with the same isolated PostgreSQL and Redis as integration tests. CI runs both commands.

The existing `/api/v1/spotkick/users/:id/wallet` summary and identity/login routes are Core-specific read adapters, outside the package wallet OpenAPI. Their small response validators remain local; no money-write or JWT claim contract is duplicated.

## Game metrics

`spotkick_active_matches` counts nonterminal matches for the current mode in PostgreSQL; all replicas see the same count, so aggregate with `max`, never `sum`. A failed/unavailable database query exposes NaN instead of a stale zero. Scrapes share a query and cache its result for one second.

`spotkick_socket_connections` is the local Engine.IO connection count, including handshakes. Sum it across replicas. `spotkick_resolution_duration_seconds` measures processing attempts that resolve an exchange, excluding player wait, row-lock wait before drive and transaction commit. Rolled-back attempts can appear. `spotkick_settlement_errors_total{mode="standalone|platform"}` counts failed ledger/Core settlement attempts; retries count separately. Histograms/counters reset on process restart; use Prometheus rate/increase.

Health remains process liveness (200) when PostgreSQL or Redis is unavailable; readiness returns 503. Integration tests close actual database and Redis connections, check HTTP responses and recovery, authenticate a real Socket.IO connection, compare the active-match gauge with SQL, and validate periodic/change events in the real PostgreSQL outbox. The Core/broker readiness values in that event-specific test are controlled doubles, not Core compatibility evidence.

## Core release gate

Platform Core is not yet tagged. Payout from house, partial capture and the permissions API in /api/v1 remain incomplete according to the owner. The service integration stays open until Core v0.2.0 is supplied and real-Core fault tests pass. Do not enable the public demo or staging against an unverified Core release.
