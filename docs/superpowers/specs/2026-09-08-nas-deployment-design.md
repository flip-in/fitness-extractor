# NAS Deployment Design

**Date:** 2026-09-08
**Status:** All sections approved 2026-09-08. Ready for an implementation plan.
**Supersedes:** the commented-out `backend`/`dashboard` stubs in `docker-compose.yml`.

## Context

- Target: Synology DS423+ ("ceres"), Celeron J4125 x86_64, 18GB RAM, DSM. Docker 24 + Compose
  v2.20 usable as user `Oberon` **without sudo** (socket is world-writable). **No git on the host.**
  `docker` lives at `/usr/local/bin/docker`, which is *not* on PATH for non-interactive SSH.
  Tailscale IP `100.121.150.120`; SSH via `~/.ssh/config` alias `ceres` (port 5555).
- Existing convention for homebrew apps: one folder per app under `/volume2/docker/` (mealie,
  plex, syncthing, …). We follow it: `/volume2/docker/fitness-extractor/`.
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

- Nightly `pg_dump -Fc` to `/volume1/homes/Oberon/backups/fitness-extractor/` — **different
  physical media** so an SSD failure doesn't take the backups with it. (Chosen over a new shared
  folder: exists already, zero DSM clicks.)
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

## Section 3 — Deploy workflow, rollback, cutover, verification (approved)

### Decision: build on the Mac, ship the image (option "c")

Considered: (a) git clone + build on the NAS, (b) rsync source + build on NAS, (c) build on Mac
and `docker save | ssh docker load`, (d) GitHub Actions → registry. Chose **(c)**:

- No git or Node on the NAS host (there is none), and no slow `vite build` on a J4125.
- NAS holds only compose, `.env`, a receiver script and pgdata. Nothing to debug there.
- Rollback is "start an older tag that's already on the NAS".
- (d) would bake `VITE_API_KEY` into a registry image; rejected in Section 1.

Cost: deploys happen from a machine with the repo + Docker (the Mac), not from a phone.

### 3.1 Deploy flow — `scripts/deploy.sh` (runs on the Mac)

1. Refuse if the working tree is dirty or the branch isn't `master`. Every deploy is a commit,
   so a rollback target is always a sha.
2. `TAG=$(git rev-parse --short HEAD)`.
   `docker buildx build --platform linux/amd64 --load -t fitness-extractor:$TAG
   --build-arg VITE_API_KEY --build-arg VITE_MAPBOX_TOKEN .` — args read from the root `.env`.
3. Build one tar stream on stdin — `image.tar.gz` (`docker save | gzip`), `docker-compose.yml`
   (from `docker-compose.nas.yml`), `receive-deploy.sh`, `backup.sh` — and pipe it to
   `ssh -i "$FITNESS_DEPLOY_KEY" -o IdentitiesOnly=yes ceres "$TAG"`. The remote command string
   is ignored by sshd (forced command, below); the receiver reads the tag from
   `$SSH_ORIGINAL_COMMAND`. A single stream because the forced command rules out `scp`; bundling
   compose + scripts keeps them in lockstep with the image.
4. Wait up to 60s for `http://100.121.150.120:3000/api/health` → 200.
5. `scripts/smoke-test.py http://100.121.150.120:3000`. On failure: print the previous tag and
   the exact rollback command, exit non-zero. **No auto-rollback** (decided: you run this by hand
   and will see it).

`FITNESS_DEPLOY_KEY` defaults to `~/.ssh/fitness-deploy`.

### 3.1a Receiver — `/volume2/docker/fitness-extractor/receive-deploy.sh` (runs on the NAS)

- Parses `$SSH_ORIGINAL_COMMAND`; accepts only `^[0-9a-f]{7,12}$`, rejects anything else.
- If stdin has data: extract the tar into the app folder (compose + scripts overwrite in place;
  the *next* deploy runs the new receiver), then `gunzip < image.tar.gz | /usr/local/bin/docker load`
  and delete the archive. If stdin is empty, the tag must already exist locally (a rollback).
- Records the currently running tag as "previous" (printed back to the caller), writes
  `TAG=<tag>` into `.env`, runs `/usr/local/bin/docker compose up -d --remove-orphans`.
- Prunes `fitness-extractor:*` images beyond the newest 3.
- Absolute paths throughout: non-interactive DSM SSH has no `/usr/local/bin` in PATH.

The NAS compose file uses `image: fitness-extractor:${TAG}` — **no `build:`**. The repo keeps a
separate `docker-compose.nas.yml` for this; the root `docker-compose.yml` stays the laptop dev
file.

### 3.1b SSH: dedicated, restricted deploy key

Requirement: interactive `ssh ceres` stays password-only; only deploys are passwordless.

- Mac: `~/.ssh/fitness-deploy` (ed25519, no passphrase), **not** in ssh-agent, **not** referenced
  by `~/.ssh/config`. Only `deploy.sh` uses it via `-i … -o IdentitiesOnly=yes`.
  *Installed 2026-09-08 and tested (`BatchMode` login works; plain `ssh ceres` still prompts).*
- NAS `~/.ssh/authorized_keys` line: `restrict,command="/volume2/docker/fitness-extractor/receive-deploy.sh" ssh-ed25519 …`.
  `restrict` = no PTY, no forwarding. `command=` = the key can run the receiver and nothing else.
  The `command=` part is added once the receiver exists (currently `restrict` only).
- Lost Mac: the key can push an image and start it on the NAS — not a shell, but revoke at once
  by deleting the line (password SSH or DSM). FileVault makes the key unreadable without login.
- New machine: generate its own key, append its own line with the same prefix. One line per
  machine; revoke per line.
- DSM gotcha handled: home dir must be `755` and `~/.ssh` `700` or sshd silently ignores keys.

### 3.2 Health checks & rollback

- `db`: existing `pg_isready` healthcheck.
- `app`: `depends_on: db: condition: service_healthy`; own healthcheck
  `wget -qO- http://localhost:3000/api/health` every 30s (the endpoint also proves DB
  connectivity). `restart: unless-stopped` on both.
- Backend config: today `backend/src/index.ts` exits if `../.env` is missing. Change to: load
  `.env` if present, otherwise use the process environment; keep the required-variable check.
- Rollback: `ssh -i ~/.ssh/fitness-deploy ceres <prev-tag>` with no stdin — same receiver, no
  upload. No schema migrations are planned; if one ever lands, its plan owns rollback.

### 3.3 First-time bootstrap (once, in the ceres shell)

1. `mkdir -p /volume2/docker/fitness-extractor/pgdata /volume1/homes/Oberon/backups/fitness-extractor`
   then `sudo chown 999:999 /volume2/docker/fitness-extractor/pgdata` (postgres uid).
2. Place `docker-compose.yml` (from `docker-compose.nas.yml`), `receive-deploy.sh`, `backup.sh`,
   and a hand-written `.env` (`DB_PASSWORD`, `API_KEY`, `TAG`) in that folder. Secrets are typed
   in once by hand; `deploy.sh` never transmits them.
3. `backend/migrations` mounted at `/docker-entrypoint-initdb.d`; new `002_seed_user.sql` inserts
   `00000000-0000-0000-0000-000000000001`. Runs only when pgdata is empty.
4. DSM Task Scheduler → user-defined script, user `Oberon`, daily 03:00, email on error:
   `/volume2/docker/fitness-extractor/backup.sh` = `docker exec fitness-db pg_dump -U postgres -Fc fitness > …/fitness-$(date +%F).dump`
   + `find … -name '*.dump' -mtime +14 -delete`.
5. Add `command=` to the `authorized_keys` line.
6. Optional: point Hyper Backup at `backups/fitness-extractor/`.

### 3.4 Cutover

1. First `./scripts/deploy.sh`. Fresh pgdata self-migrates and seeds the user. The smoke test
   must pass against an **empty** DB: add `--allow-empty` (today it fails with "no workouts to
   test against").
2. Phone: `Config.swift` → `apiBaseURL = "http://100.121.150.120:3000"`,
   `historicalImportDays = 1100`; rebuild from Xcode; tap Import once (the accepted foreground
   exception). Then set the constant back to 90.
3. Laptop `fitness-db` stays as the dev DB. No data migration (Section 2).
4. Browser homepage → `http://100.121.150.120:3000`.

### 3.5 Verification — done when all are true

- `smoke-test.py` 13/13 against the NAS with data.
- Row counts match the laptop DB: 1343 workouts / 944 routes / 846 rings, ± today's activity.
- Dashboard loads over Tailscale off-LAN (phone hotspot).
- Next morning, without opening the app: `pendingRoutes` on the phone has dropped and backend logs
  show `updated` counts. Proves M6 and the background-only sync together.
- A dump appears after the first scheduled backup; restore drill: `pg_restore` into a scratch
  container, compare row counts.

## Out of scope

- Auto-rollback, TLS / reverse proxy, container registry, migration runner, multi-user.
- Dashboard vulnerability cleanup (vite 7→8, plugin-react 5→6): build-time only, never reaches
  the runtime image. Leave until deployment is stable.
