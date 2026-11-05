# Verification evidence

Verified locally on 5 November 2026. These are executed checks, rather than an estimate of production capacity.

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

The load figures include complete match duration, including animation pauses and occasional sudden death. They are small smoke runs on one workstation, not a saturation benchmark or a latency SLA. JSON summaries are saved as [single-instance results](load-smoke.json) and [two-instance results](load-two-instances.json).

Local execution used Node 24.17, PostgreSQL 18 and a Redis 8.10 Windows build in an isolated workspace. Docker/CI target Node 22, PostgreSQL 17 and Redis 7.4; the used database, crypto and adapter features are compatible, but those container runtimes have not been executed locally.

## Not executed here

- Docker Engine/Compose are not installed on this host. The Compose file, migration job, multi-stage images and CI image-build step are provided; image builds and `docker compose up --build` still need execution on a Docker host.
- GitHub Actions has not run remotely; this repository is local and has not been pushed.
- Sentry instrumentation builds and initializes, with reporting disabled when no DSN is configured. No real event ingestion was tested.
- A broad accessibility audit, Lighthouse benchmark, network partition test and failover under sustained load have not been performed.

## Preview artifacts

- [Desktop lobby](preview-lobby.png)
- [Mobile lobby](preview-mobile.png)
- [Completed match](preview-match.png)

All screenshots come from the running application with real API/Redis/PostgreSQL interactions. Lobby counts and results reflect actual local test sessions.
