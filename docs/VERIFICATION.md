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

GHCR publication/manifest/image smoke are pending their first workflow execution at the time of this entry. NAS import and resources are not verified. No platform-infra files, NAS services or demo images were modified. Required changes are proposals in platform-infra-additions.md; they are not applied configuration.
