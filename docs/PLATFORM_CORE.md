# Platform Core mode

SpotKick uses the demo ledger by default. Set `CORE_URL` on the API to enable Core for live two-player matches. In this mode, balances and journal entries come from Core in EUR minor units. Demo bots and solo stakes are disabled.

## Configuration

Set `CORE_URL`, `CORE_ISSUER`, `CORE_AUDIENCE`, `CORE_CLIENT_ID` and `CORE_CLIENT_SECRET` on the SpotKick API. Use `http://127.0.0.1:4101` for a host-run local API and HTTPS outside loopback. Keep the client secret in server-side configuration. The issuer and audience must match the Core JWT configuration.

Provision a Core client with `spotkick:matches` and write grants for both players' EUR cash wallets. Each player needs a verified Core account, available funds and responsible-gaming capacity. Users sign in with their Core credentials. The browser keeps the short-lived access token for the current tab and prompts for sign-in again when it expires.

## Match lifecycle

SpotKick persists a match ID and its pending wallet action before sending a request. Core reserves both stakes in one PostgreSQL transaction. When the game has a winner, Core captures both stakes, credits the winner and books the rake in one PostgreSQL transaction. A cancelled match releases both stakes. Holds expire after 30 minutes.

The request keys are `match:<id>:reserve`, `match:<id>:settle` and `match:<id>:release`. SpotKick retries with the same key and body if a response is lost, then advances the match when Core confirms the result. Keep Core available while active Core matches drain before changing modes.

## Local integration test

Start a Core API with test deposits enabled and an isolated database whose name ends in `_test`. Point SpotKick to a separate `_test` database and a dedicated Redis database. Set `SPOTKICK_CORE_E2E=1`, `SPOTKICK_CORE_TEST_DATABASE_URL` and the Core URL and issuer, then run:

```sh
pnpm exec vitest run tests/integration/core-wallet.test.ts
```

The test provisions disposable verified users and a scoped client. It plays a two-user match, loses the reserve and settlement responses after Core commits, retries the operations, verifies payout and rake, refunds a cancellation and checks that excluding one participant rolls back both reservations.
