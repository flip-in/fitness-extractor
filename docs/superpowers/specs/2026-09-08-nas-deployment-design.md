# NAS Deployment Design

**Date:** 2026-09-08
**Status:** Sections 1–2 approved in conversation. Section 3 not yet designed.
**Supersedes:** the commented-out `backend`/`dashboard` stubs in `docker-compose.yml`.

## Context

- Deploys via SSH + `docker compose` on the Synology. Tailscale already installed and working.
- No Dockerfiles exist yet. `docker-compose.yml` runs only `db`.
- HealthKit on the phone is the source of truth. Imports are idempotent
  (`ON CONFLICT healthkit_uuid`), so the DB is fully reconstructible. This is why the backup
  design below is deliberately modest.
- Backend is on Express 5 (done first, deliberately: the SPA fallback wildcard syntax changed).
- Motivation: "more robust persistence" than a laptop-local Docker volume.

## Section 1 — Topology (approved: "A sounds right. we aren't married to it")

Two services in `docker-compose.yml`, both `restart: unless-stopped`:

| service | image | ports | role |
|---|---|---|---|
| `db` | `postgres:16` | none published (compose network only) | data |
| `app` | built from repo root | `0.0.0.0:3000:3000` | `/api/*` **and** dashboard static build |

**Same-origin serving eliminates CORS** — the sharpest edge in the current split-process setup.
`cors()` middleware stays for local dev but is irrelevant in production.

### Express route order (Express 5)

1. `/api/*` routers first (existing).
2. `express.static(<dashboard build dir>)`.
3. SPA fallback **last**: `app.get('/*splat', …)` → `index.html`. Express 5 uses
   path-to-regexp v8, so the wildcard is `/*splat`, not `'*'`. Placing it earlier swallows the API.

### Dockerfile (multi-stage, at repo **root** — build spans both pnpm workspace packages)

1. `deps`: `node:24-alpine`, corepack pnpm, `pnpm install --frozen-lockfile`.
2. `build`: `pnpm -r build` (backend `tsc`, dashboard `tsc -b && vite build`).
   `ARG VITE_API_KEY`, `ARG VITE_MAPBOX_TOKEN` baked in at this stage.
3. `runtime`: `node:24-alpine`, prod deps only, `backend/dist` + `dashboard/dist`.
   `CMD node dist/index.js`.

Needs a `.dockerignore` (node_modules, `ios/`, `dist/`, `.env`, `docs/`) or the context includes
the whole Xcode project.

### Dashboard API base

`dashboard/src/api.ts`: `API_BASE_URL` default becomes `""` (relative, same-origin).
Local split-process dev still sets `VITE_API_URL` via `scripts/dev-server.sh`.

### Secrets

- `VITE_API_KEY` is a Vite build arg and **lands in an image layer**. Accepted explicitly:
  "yeah that's fine, image stays on the nas". Image is built on the NAS, never pushed to a
  registry. Tailscale is the security boundary.
- Runtime secrets (`DB_PASSWORD`, `API_KEY`) via `.env` next to the compose file on the NAS.
- `backend/src/index.ts` currently hard-exits if `../.env` is missing — must tolerate env-only
  config in the container.

### Network exposure

Publish on `0.0.0.0:3000`: LAN speed at home, Tailscale when away. Tighter alternative
(bind Tailscale IP only) was offered; user did not object to `0.0.0.0`.

## Section 2 — Persistence & backup (approved)

### Live data

- `pgdata` bind-mounted to `/volume2/docker/fitness-extractor/pgdata`. volume2 is the SSD.
- **volume2 is a single SSD with no redundancy** (user confirmed). Drive failure loses the live
  DB. The dumps below are therefore load-bearing, not optional.

### Backups

- Nightly `pg_dump -Fc` to `/volume1/...` — **different physical media** so an SSD failure
  doesn't take the backups with it.
- 14 days retained.
- Driven by **DSM Task Scheduler** (not a cron container): visible in DSM, survives container
  churn, can email on failure. Command shape:
  `docker exec fitness-db pg_dump -U postgres -Fc fitness > /volume1/.../fitness-$(date +%F).dump`
  plus a `find -mtime +14 -delete`.
- Point Hyper Backup at the backups folder for off-NAS copies.

### Gotchas to handle in the plan

1. `postgres:16` runs as uid 999. `chown -R 999:999` the pgdata dir over SSH **before first
   boot** or Postgres refuses to start.
2. pgdata must be a **local** volume. Never bind-mount it onto NFS/SMB — corruption risk.
3. Btrfs snapshots of a running Postgres dir are crash-consistent at best. Not a backup.

### Schema bootstrap

No migration runner exists. Mount `backend/migrations` at `/docker-entrypoint-initdb.d` so a
fresh pgdata self-migrates. **The migration does not seed the user row**, but every data table
has `FK user_id → users`; a fresh DB fails every import until
`00000000-0000-0000-0000-000000000001` exists. Add a `002_seed_user.sql`.

### Recovery

Restore last night's dump, then run a short "Import Last N Days" from the phone to fill the gap.
The import path passes `anchor: nil` so it backfills cleanly. Nightly is sufficient because the
phone covers the last-24h window.

### Data migration from the laptop

**Skip it.** Point the phone at the NAS and import fresh. One less moving part, and it validates
the deployment end to end.

## Section 3 — Deploy workflow, cutover, verification (NOT YET DESIGNED)

To be brainstormed and approved before implementation. Must cover:

- Deploy: `ssh nas 'cd /volume2/docker/fitness-extractor && git pull && docker compose up -d --build'`
  or equivalent; where the repo lives on the NAS; who owns the checkout.
- Rollback: previous image tag / `git checkout <sha> && up --build`.
- Health checks: compose `healthcheck` on `app` hitting `/api/health`; `depends_on: condition:
  service_healthy` on `db`.
- Deploy gate: `./scripts/smoke-test.py http://<nas>:3000` (13/13 currently passing locally).
- Cutover: update `ios/.../Config.swift` `apiBaseURL` to the NAS Tailscale address, rebuild
  from Xcode, run "Import Last N Days" with `historicalImportDays` raised, then set it back to 90.
- Verification: row counts in DB match a laptop import of the same window; dashboard loads over
  Tailscale from off-network; background metric sync lands overnight.
- Browser homepage → dashboard (ROADMAP Phase 4 item).

## Out of scope

- Dashboard vulnerability cleanup (vite 7→8, plugin-react 5→6): build-time only, never reaches
  the runtime image. Leave until deployment is stable.
- Multi-user, TLS, reverse proxy: Tailscale is the boundary.
