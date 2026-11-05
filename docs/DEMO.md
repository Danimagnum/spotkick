# Review SpotKick in five minutes

Use this walkthrough for a portfolio review, screen recording or interview. Outcomes are real: there is no forced win, scripted opponent result or simulated balance.

## Before the walkthrough

Run `docker compose up --build` on a Docker host and open http://localhost:3000. Container execution has not yet been verified on the development workstation; see [verification evidence](VERIFICATION.md). If the local apps are already running, use their existing URL.

Use a fresh browser profile for a clean 1,000 S guest wallet. No registration, payment details, cloud key or Sentry account is required. Keep the visible play-money/responsible-gaming notice in view when presenting the product.

## 0:00–0:45 — Explain the product

“SpotKick is a penalty shootout with play credits. Both players shoot and keep in every round. The portfolio focus is simultaneous decisions, recovery and correct money movement.”

Show the original arena, stake selector and live lobby. Choose 10 S. Find a match; if no compatible human is waiting, an explicitly marked bot joins after five seconds.

The lobby contains actual connected guests and completed results. Empty states are expected on a fresh database.

## 0:45–2:00 — Play and reconnect

Pick a zone when shooting and when keeping. Matching choices save the shot. Goals earn 1, 2 and 3 points in the three rounds. A tie adds complete sudden-death pairs.

Reload once during the match. The same wallet and match return from the server. Continue playing. The guest token survives in localStorage; a pending commitment secret survives a reload in sessionStorage.

To demonstrate a timeout, allow one choice countdown to expire. Explain that an auditable fallback is used and recorded as a timeout exception. Match duration varies with player decisions and sudden death; five minutes is a presentation outline, not a guarantee of a fixed match length.

## 2:00–3:00 — Inspect the money

Open the wallet journal after the result:

- A fresh wallet starts at 1,000 S.
- Locking a 10 S stake leaves 990 S available.
- The pot is 20 S. With the default fee, 0.60 S goes to the rake account and 19.40 S goes to the winner.
- The winner's fresh wallet ends at 1,009.40 S; the loser's ends at 990 S.

The interface may omit trailing decimal zeroes. Show the **stakes locked** journal entry and, if the guest won, the settlement entry. Then open **Inspect match fairness** and verify the transcript.

“The balance is derived from immutable journal entries. Settlement, terminal game state and its notification commit in the same PostgreSQL transaction.”

## 3:00–4:00 — Verify a solo run

Open Solo run. Show the server-seed hash before starting and change the client seed. Take a shot. If it scores, cash out; if it is saved, the run ends naturally. Either outcome reveals the retired seed.

Click **Verify this run**, then **Verify this shot**. The browser checks the original seed commitment and reproduces the keeper's zone. The transcript lists the shot nonce, player's zone, keeper's zone and outcome.

“The server committed before the stake. The player can reproduce the outcome after the seed is revealed.”

## 4:00–5:00 — Show engineering evidence

Open [the case study](CASE_STUDY.md) and [verification evidence](VERIFICATION.md):

- 100 concurrent bet attempts against one wallet, followed by 100 settlement attempts including duplicates.
- Rejected overdrafts, balanced journals, immutable/sealed transactions and exactly-once payouts.
- A complete six-exchange match and reconnect snapshots against PostgreSQL/Redis.
- Twelve concurrent players across two API instances, all completing with correct balances.
- Explicit limits: operator censorship is not prevented by commit–reveal; the small k6 runs are not a capacity benchmark.

Do not describe the k6 match-duration percentile as individual request latency. It includes the entire match, animation pauses and sudden death.

## Optional: human versus human

Open two independent browser profiles, choose the same stake, and queue both within five seconds. Each guest gets a separate wallet. Choosing different stakes intentionally prevents pairing. Ordinary tabs in the same profile share a guest identity and do not represent two players.

## Portfolio publication checklist

- [x] Playable browser flows and original visuals.
- [x] Bot fallback for reviewers arriving alone.
- [x] Visible play-money and responsible-gaming notices.
- [x] Source, architecture diagrams, repeatable test commands and local evidence.
- [ ] Validate a clean Docker build and startup on the target host.
- [ ] Publish the repository and obtain a successful remote CI run.
- [ ] Add a public HTTPS/WSS demo URL and verify it from another device.
- [ ] Record a short walkthrough from the deployed version.
- [ ] If Sentry is enabled for the demo, verify a test event reaches the project.

The unchecked items are publication work, not features silently claimed as complete.
