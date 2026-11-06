# Public deployment preparation

The main portfolio website stays on its current Raiola shared hosting. The proposed demo URL is `https://spotkick.danielgil.eu`; the API uses `https://api.spotkick.danielgil.eu`. Both DNS records must point at the application host, not at the shared hosting IP. No DNS changes have been applied yet.

The application host must support long-running Docker services, PostgreSQL, Redis, persistent volumes and WebSocket connections. Shared hosting alone has not been established to support this stack. Provider selection and spending require the owner's decision.

## Existing host with Docker and an HTTPS reverse proxy

Copy `.env.production.example` to `.env.production`. Generate a unique database password (hex avoids URL escaping), and put it in both password fields. Configure the exact web/API origins before building: Next.js embeds the public API URL at build time.

```sh
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up --build -d
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml ps -a
```

The migration job must exit 0 before API startup. PostgreSQL and Redis have no published host ports. Web/API listen only on host loopback ports 3300/3301. Persistent volumes retain PostgreSQL data and Redis AOF. Changing the database password variable does not rotate an already initialized PostgreSQL user's password; use the database's password rotation procedure for an existing installation.

Configure the host's HTTPS reverse proxy:

| Public origin | Upstream | Required behavior |
|---|---|---|
| `https://spotkick.danielgil.eu` | `http://127.0.0.1:3300` | Forward Host and HTTPS scheme |
| `https://api.spotkick.danielgil.eu` | `http://127.0.0.1:3301` | Forward Host/scheme; HTTP/1.1 WebSocket Upgrade and Connection headers; idle timeout at least 120 seconds |

Issue certificates for both names and redirect HTTP to HTTPS. Reverse proxy software is intentionally not added until the host is selected. A containerized proxy needs a shared Docker network and service-name upstreams instead of host loopback. Do not expose PostgreSQL/Redis or change the existing portfolio site's DNS records.

## Acceptance before linking from the portfolio

1. Open the HTTPS demo on a different device/network. Check that all API/WebSocket traffic uses HTTPS/WSS.
2. Complete a bot match, reload during a pending choice, verify its transcript and inspect the settled wallet.
3. Complete a solo run, verify its seed, alter the hash and confirm rejection.
4. Repeat the two-guest PvP recovery test with `WEB_URL` and `API_URL` set to the public origins. Do not run load tests against visitors.
5. Restart the API and verify identity/wallet recovery; inspect logs and database invariants using the Windows acceptance guide's SQL.
6. Configure off-host database backups and perform a restore into an isolated database. Keep secrets out of logs and source control.
7. Link the live demo and GitHub repository from a SpotKick project card on the portfolio. Include the case study, actual test evidence and a short gameplay recording.

Public deployment, certificates, DNS, backups and the portfolio card are pending until access to the selected host and website is available. Local production Compose validation does not prove deployment on that host.
