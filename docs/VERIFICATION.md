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

- GitHub Actions has not run remotely; this repository is local and has not been pushed.
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
