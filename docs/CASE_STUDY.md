# SpotKick: simultaneous choices and consistent wallets

SpotKick is a playable engineering portfolio project: a real-time penalty shootout using play money. Its purpose is to make distributed-state decisions inspectable through the product, source and executed tests.

## The problem

A small multiplayer game has several independent correctness problems. Two players must choose without seeing the other's decision. A reload must not create a new match or lose the original commitment. Two requests must not spend the same balance. A duplicated settlement must not pay twice. A process restart must not erase the timer or the escrow liability.

The interface makes these problems observable: locked choices, countdowns, reconnect recovery, round scores, wallet entries and fairness transcripts all correspond to durable backend behavior.

## Architecture decisions

| Decision | Reason | Tradeoff |
|---|---|---|
| PostgreSQL owns match state and money | One database transaction can commit the result, payout and outbox event together | Match JSON snapshots and active-state scans have limits at larger scale |
| Redis indexes matchmaking and carries Socket.IO broadcasts | Connections can live on separate API instances; queue/cache loss does not lose funded games | Redis outages pause real-time delivery and matching |
| Account-row locks and integer journal entries | Concurrent requests serialize before checking spendable funds; arithmetic is exact | Shared house accounts become deliberate hot spots |
| Commit–reveal with context-bound hashes | A reveal cannot change a previously committed choice or reuse it in another exchange | Missing reveals require an explicit fallback policy; censorship remains possible |
| Transactional outbox | A committed result remains publishable after a process crash | Delivery is at least once; versions and command idempotency remain necessary |
| Guest identities and delayed bots | A reviewer can play immediately without registration or another visitor | Guest recovery and abuse prevention are intentionally limited |
| Original SVG arena and Framer Motion | The product has its own visual identity and reacts to real results | The presentation is stylized rather than a physics simulation |

## A concrete wallet race

The contention test creates one wallet with 100,000 minor units and launches 100 simultaneous requests to stake 3,000 units each. Only 33 stakes are affordable. The test asserts exactly 33 succeed, the other requests fail for insufficient funds and the wallet retains 1,000 units.

It then launches 100 settlement calls against those accepted escrows, including duplicate requests. Exactly 33 payouts are posted. Each pays 2,910 units and sends 90 units to the rake account. The wallet ends at 97,030 units; every settled escrow is zero; the sum of all journal entries remains zero.

This tests observable invariants against PostgreSQL. It is not an in-memory mock of a balance update.

The journal also rejects updates/deletes, unbalanced transactions and later entry insertion into a previously committed transaction. Database ownership remains an operator trust boundary; production should separate migration ownership from the runtime role.

## A concrete recovery path

1. The browser writes the choice and random salt to sessionStorage before sending the commitment.
2. The API locks the match row, checks phase/deadline/exchange and persists the hash.
3. A reload reconnects the authenticated guest, rejoins the room and reads a current snapshot.
4. If a reveal is needed, the browser can send the original secret. A commit retry preserves that secret even if the original acknowledgement was lost.
5. If the secret or connection does not return in time, the published fallback policy resolves the exchange and records the exception.

The server does not depend on a particular socket remaining connected, or on a timeout closure surviving in one process.

## Fairness boundaries

PvP commitments bind a choice and salt to a match, round, exchange and player. Opponent reveals remain hidden until resolution. End-of-match transcripts allow checking ordinary reveals and deterministic timeout choices.

Solo keeper choices use HMAC-SHA256 with a server seed committed before the stake, a player-selected client seed and a monotonic nonce. The seed is revealed only after the run. Browser Web Crypto reproduces outcomes, and tests independently compare the implementation with Node's crypto library.

These mechanisms prove specific consistency properties. They do not prove that a malicious operator selected seeds honestly, delivered messages impartially or ran the published implementation. That limitation is part of the design explanation.

## Executed results

- Seven unit tests and six PostgreSQL/Redis integration tests passed locally.
- Three Playwright flows passed: full bot match/reload/settlement/transcript, pending PvP commitment recovery against an authenticated HTTP rival, and solo settlement/browser verification.
- A 12-player k6 smoke run split connections across two API processes. All players completed, all wallet checks passed and no HTTP requests failed.
- The two-process run's p95 complete-match duration was 22.63 seconds. It includes gameplay and is not an API latency measurement or proof of production capacity.
- API and Next.js production builds and TypeScript checks passed.

See [verification evidence](VERIFICATION.md) and its saved metric summaries for execution details and untested items. Docker builds, startup and two-instance load passed locally. Remote CI passed, including Playwright and Docker builds; live Sentry ingestion remains unverified.

## Source tour

| Review question | Source |
|---|---|
| How are phases, deadlines and paired rounds enforced? | [Match engine](../apps/api/src/matches/engine.ts) |
| Why can the same balance not fund concurrent overspending? | [Ledger](../apps/api/src/wallet/ledger.ts) |
| Which invariants does PostgreSQL enforce? | [Initial migration](../apps/api/src/database/migrations/1700000000000-Initial.ts), [journal sealing](../apps/api/src/database/migrations/1700000000001-LedgerSealing.ts) |
| How are committed results delivered after failures? | [Outbox runtime](../apps/api/src/runtime.ts) |
| How does solo reserve the next payout? | [Solo service](../apps/api/src/solo/solo.ts) |
| How can another implementation reproduce the rules? | [Shared rules, contracts and fairness](../packages/shared/src/index.ts) |
| What actually runs concurrently in the tests? | [Integration suite](../tests/integration/system.test.ts) |
| How is cross-instance gameplay exercised? | [k6 Socket.IO client](../tests/load/matches.js) |

## What would change at larger scale

Claim indexed, bounded batches of due deadlines rather than scanning all active matches. Partition queue claims by stake/region. Shard house ledger accounts, introduce audited balance projections and partition journal history. Materialize lobby aggregates, monitor outbox age and test failover with real network faults. Use synchronized clocks or database-owned deadline comparisons across hosts.

Those changes should follow measurements. The current project exposes its serialization points and recovery paths rather than claiming that horizontal replication removes database contention.
