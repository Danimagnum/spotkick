# Verification evidence

Verified locally on 5–6 November 2026. These are executed checks, rather than an estimate of production capacity.

| Check | Result |
|---|---|
| `pnpm test` | 7 unit tests passed |
| `pnpm test:integration` | 6 tests passed against real PostgreSQL and Redis |
| Wallet contention | 100 simultaneous bet attempts; exactly 33 affordable stakes accepted; 100 settlement attempts; exactly 33 payouts; total money conserved |
| Database invariants | Updates/deletes rejected; unbalanced journals rejected; appending to a sealed journal rejected |
| `pnpm typecheck` | Shared package, API and web passed |
| `pnpm build` | API and all Next.js routes built successfully |
| Playwright | Full bot match, mid-match reload, fairness transcript, settled wallet and journal passed; solo settlement and browser verification passed |
| Single-API k6 smoke | 4 concurrent players; 4/4 complete; wallet checks 4/4; no HTTP failures; match p95 12.87 seconds |
| Two-API k6 smoke | 12 concurrent players split between ports 3001/3002; 12/12 complete; wallet checks 12/12; no HTTP failures; match p95 22.63 seconds |
| Browser rendering | Desktop and mobile captures; no page JavaScript errors or horizontal overflow at 390px |
| Runtime logs after final startup/load | No API runtime errors |
| `git diff --check` | Passed |
| Docker acceptance | API/web production images built; migrations exited 0; PostgreSQL, Redis and both API instances healthy; web HTTP 200 on 127.0.0.1:3180 |

The load figures include complete match duration, including animation pauses and occasional sudden death. They are small smoke runs on one workstation, not a saturation benchmark or a latency SLA. JSON summaries are saved as [single-instance results](load-smoke.json) and [two-instance results](load-two-instances.json).

Initial native execution used Node 24.17, PostgreSQL 18 and Redis 8.10. On 6 November, the production Docker images were built and run with Node 22.23.4, PostgreSQL 17 and Redis 7.4.12. All seven unit tests, six real integration tests and three TypeScript checks passed inside the API image. Docker Desktop 4.98.0 / Engine 29.9.2 / WSL 3.0.3 hosted the acceptance stack.

## Not executed here

- Public NAS deployment, DNS/certificates and external-device acceptance are not executed yet.
- Sentry instrumentation builds and initializes, with reporting disabled when no DSN is configured. No real event ingestion was tested.
- A broad accessibility audit, Lighthouse benchmark, network partition test and failover under sustained load have not been performed.

## Preview artifacts

- [Desktop lobby](preview-lobby.png)
- [Mobile lobby](preview-mobile.png)
- [Completed match](preview-match.png)

All screenshots come from the running application with real API/Redis/PostgreSQL interactions. Lobby counts and results reflect actual local test sessions.

## Docker acceptance, 6 November

- Twelve k6 players split across API ports 3101/3102: 12/12 completed, 12/12 wallet assertions passed, all 36 checks passed, zero failed HTTP requests. Complete-match p95 was 15.10 seconds; HTTP request p95 was 1.32 seconds. [Saved summary](load-docker-two-instances.json).
- An earlier run started before the second API was ready and failed. Its [summary is retained](load-docker-cold-start-failed.json). The script now checks every API health endpoint before starting load. The passing run used healthy services and no simultaneous image build.
- Browser checks at 360, 390, 768, 1280 and 1440 px found no horizontal overflow. Wallet focus remained within the dialog; Escape closed it. No page JavaScript errors were observed in this audit.
- Unauthenticated access returned 401; an invalid stake returned 400 without changing the 100,000-unit guest balance. The solo browser verifier rejected an altered hash and accepted the original.
- An exploratory two-browser PvP test reached a verified 6:0 result with correct payouts but timed out in teardown. A repeat failed guest readiness under workstation contention. The recovery regression now uses one browser and a second authenticated HTTP participant, exercising the same public commit/reveal protocol without the second browser context.
Final Docker browser suite: **3/3 Playwright tests passed** (bot/reload/ledger/keyboard; browser plus HTTP rival with pending commitment and both payouts; solo/browser verification). The PvP recovery case completed in 16.7 seconds. Desktop and mobile captures were refreshed from the Docker web app with no page errors or horizontal overflow. Final SQL audit: journal sum 0, zero unbalanced transactions, zero negative spendable accounts.

Restart check: restarted only the acceptance API and Redis; the same authenticated guest recovered with its unchanged 100,000-unit balance. This checks process recovery and wallet persistence, not a network-partition or sustained-load failover guarantee.

## Remote CI, 6 November

Repository published at [Danimagnum/spotkick](https://github.com/Danimagnum/spotkick). [GitHub Actions run 42255301988](https://github.com/Danimagnum/spotkick/actions/runs/42255301988) passed for code commit a7dae35: frozen installation, unit tests, TypeScript, PostgreSQL/Redis integration tests, production builds, all three Playwright tests and both Docker targets. Two earlier runs were cancelled after the browser-download step stalled; CI now uses the Chrome already installed on the Ubuntu 24.04 runner.

## Contract 0.2.0 alignment, 11 November 2026

Executed on the PR branch: npm 0.2.0 installed exactly; API TypeScript passed; 17 existing unit tests passed; 14 integration tests passed against isolated Docker postgres:17-alpine and redis:7.4-alpine (loopback ports 25432/26379), plus two contract tests using the published testing kit. The grouped HTTP fixtures are test doubles, not Core. Three deliberate mutations were detected by assertions: implicit Core activation, skipped event validation and a changed money idempotency key. Source was restored after each mutation.

Not yet verified for this revision: the exact published Core image (tag/digest not supplied), real-Core failure scenarios, Kafka delivery, 200 simultaneous matches, new CI run, GHCR publication or physical mobile acceptance. Previous results above describe earlier revisions and are not evidence for these outstanding checks. No platform-infra or NAS deployment was changed.

## Operational checks, 11 November 2026

Executed locally against isolated Docker PostgreSQL 17 and Redis 7.4: 16 integration tests passed, including two new operational tests. HTTP readiness changed 200 → 503 → 200 when actual Redis and PostgreSQL connections were closed/reopened; liveness stayed 200. A real authenticated Socket.IO connection changed the local gauge 0 → 1 → 0. Active-match metrics matched SQL; an unavailable database exposed NaN. The PostgreSQL health outbox contained initial, degraded, recovered and periodic 30-second facts validated by the 0.2.0 kit. Broker and Core probe values in this health-event test were controlled doubles. Resolution and settlement-error metrics were asserted during the grouped-wallet fault suite.

Six deliberate mutations were detected (readiness dependencies, health changes, resolution metrics, standalone opt-in, event validation and stable idempotency). None of these checks certifies the unfinished Core release. The owner has explicitly left Core integration and PR merge pending Core v0.2.0.

## Kafka and secret scanning, 11 November 2026

The complete local integration command passed 17 tests with real isolated PostgreSQL 17, Redis 7.4 and Redpanda v24.3.18. The Kafka test reads an event from the PostgreSQL outbox, publishes it twice and verifies the same envelope ID, aggregate key, event-id and correlation-id on both received records; shutdown readiness is false. CI provisions isolated Apache Kafka 4.1.0 KRaft for that same test. The opt-in Core test remains skipped explicitly. Unit/contract tests: 19 passed. Full monorepo typecheck passed.

Gitleaks v8.30.1 (official image digest c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f) detected its generated disposable private-key control; full Git history and current tracked/unignored files had no findings. Logs are redacted; no real credential was introduced for the control. Actionlint 1.7.12 validated the publication workflow.

GHCR publication, remote manifest and standalone image smoke passed in [push run 43071313828](https://github.com/Danimagnum/spotkick/actions/runs/43071313828). Image: `ghcr.io/danimagnum/spotkick-api:sha-67f725871ad3ad232d9e5666d2b564b56a5d0fc3`, digest `sha256:49ecf040d61499725bdea1f196ce76e4faf70bca5004937f6622dc18b55638fc`. The remote image uses the Docker v2 manifest and gzip layers, is linux/amd64 and starts non-root with a read-only filesystem and tmpfs /tmp against isolated PostgreSQL/Redis. With PLATFORM_MODE=false and CORE_URL pointing to an unreachable loopback port, /mode stayed demo and live/ready/metrics responded successfully. NAS import and resources are not verified. No platform-infra files, NAS services or demo images were modified. Required changes are proposals in platform-infra-additions.md; they are not applied configuration.

The subsequent health-queue regression test covers recovery after all 64 pending slots are occupied and preservation of observation-time HTTP statistics. Both defects were introduced deliberately and detected by assertions. The mutation suite now covers eight regressions; unit/contract total is 20. This last correction must pass its own CI and image job before selecting its newer commit image.

Gitleaks flagged the public `sha-67f725871ad3ad232d9e5666d2b564b56a5d0fc3` image tag as a generic API key when written after the image repository name. .gitleaks.toml retains all default rules and allows only that exact nonsecret tag in the two evidence documents (path AND secret match). No entire path, commit or rule is excluded. The positive private-key control remains mandatory.

After this narrowly scoped exception, a second synthetic generic-API-key control was added. Both controls were detected with redacted output; full-history and current-file scans then passed.

## Core v0.2.0 / contracts 0.3.0, 12 November 2026

The exact image and running /health/live were checked against commit 3fd3c707fc78e1f7096ed6559112106ee47d2009 before the opt-in test. `pnpm test:core:mutations` passed locally with real PostgreSQL/Redis/Kafka and the released Core image. Player grants were absent and machine wallet access returned 403 before player activation. Player sessions created EUR grants. The completed match paid 1940 with commission 60; the global ledger sum was zero. Three successful Core replies were deliberately lost (reserve, settle, release), with new engine/client instances resuming the persisted commands. A 503 after the winning decision did not change that decision. Twenty concurrent settlement replays and twenty refund replays added no journal transactions; changed winner with the same key returned 409. Self-exclusion via the player API prevented a new reservation without holds. [Machine-readable results](core-v020-results.json).

Two mutations were detected against real Core: bypassing player activation and changing the reserve key after a lost reply. KYC verification and test deposits are fixtures on isolated test databases; full KYC/storage and real funding are outside this test. No NAS/staging endpoints were used.

## Two-instance 200-match workload, 12 November 2026

The before run completed all 200 matches but reached only 48 active simultaneously (p95 126.4817 s). After bounded matchmaking and indexed due-only ticking, a repeat with identical workload reached 200 active matches and 400 connections. All 200 settled, all 400 wallet checks passed, command/HTTP errors and timed-out exchanges were zero. Complete-match p95 was 52.78245 s; HTTP p95 167.62728 ms. SQL ledger sum 0; negative spendable accounts 0. Environment, scheduling barriers, samples and raw k6 metrics are retained in load-200-before.json and load-200-after.json. The JSON threshold flags are k6 breach flags (false means not breached); exit code 0 confirms the functional thresholds. The baseline still fails the explicit 200-simultaneous target.

This workload is standalone with a 60-second choice window and preprovisioned guests; it does not establish Core, default-window or NAS capacity. No NAS or public Funnel URL was used. The due-only worker regression is tested against actual PostgreSQL, including future and other-mode work.

## Core wallet consumption and final local release checks, 12 November 2026

A real Kafka test publishes an official core.wallet.transaction_posted.v1 event twice and waits for committed offsets: one inbox row, one walletChanged notice, zero local journal entries, and no DLQ for the valid duplicate. Malformed JSON produces exactly one DLQ entry. The opt-in exact-image Core test also starts this consumer and observes real Core-worker wallet events reaching the local notification outbox. It then repeats all financial fault/replay checks and the two real-Core mutations. This consumer changes no money and readiness includes group availability. The integration guide records the implemented flow and the outstanding NAS/mobile checks.

Final local counts: 21 unit/contract tests; 20 standard PostgreSQL/Redis/Kafka integration tests plus the separately executed real-Core release scenario; 12 standard mutations plus two real-Core mutations. The SQL rollback test forces notification insertion to fail and proves the inbox claim is rolled back before a successful deduplicated retry. The published CI runs contract/build/Playwright/image checks; exact final CI and image references are recorded on PR #1 when merging. Physical mobile acceptance, NAS import/resources/rollback and Core capacity remain unverified; public demo and platform-infra are unchanged.
