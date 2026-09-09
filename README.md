# Fitness Extractor

A personal fitness data extraction system that syncs HealthKit data from iOS to a PostgreSQL
database, with a web dashboard for visualisation.

## Components

1. **iOS App** (Swift/SwiftUI) — extracts HealthKit data with automatic background sync
2. **Backend API** (Node.js/Express/PostgreSQL) — stores and serves fitness data
3. **Web Dashboard** (React/Vite/Mapbox) — visualises activities and GPS routes

## Features

- **Automatic HealthKit sync** — background delivery triggers sync on new health metrics
- **Full GPS routes** — complete workout routes with altitude, speed, accuracy
- **Historical import** — configurable lookback window
- **Activity rings** — daily Move, Exercise, Stand tracking
- **Health metrics** — heart rate, steps, active energy
- **Web dashboard** — workout list, detail modal, Mapbox route rendering, activity rings
- **RESTful API** — API key authenticated

Not yet done: containerised deployment to the NAS (see `ROADMAP.md` Phase 4), and a GPS heatmap
view (research complete in `docs/heatmap-feature/research.md`).

## Quick Start

### Prerequisites

- **macOS** with Xcode 15+ (for iOS development)
- **Docker** (for PostgreSQL)
- **Node.js** 22+ with corepack enabled
- **pnpm** (via corepack)
- **iPhone** with iOS 17+ — HealthKit requires a physical device

### 1. Install

```bash
git clone https://github.com/flip-in/fitness-extractor.git
cd fitness-extractor
corepack enable
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Set your values in `.env`:

```bash
DB_PASSWORD=your_secure_password
API_KEY=your_api_key              # openssl rand -base64 32
VITE_API_KEY=same_as_API_KEY
VITE_MAPBOX_TOKEN=pk.your_token   # account.mapbox.com/access-tokens
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:3000
```

### 3. Start the database and apply the schema

```bash
docker compose up -d db
docker exec -i fitness-db psql -U postgres -d fitness < backend/migrations/001_initial_schema.sql
```

There is no migration runner — the schema is applied manually as above.

Verify:

```bash
docker exec fitness-db psql -U postgres -d fitness -c "\dt"
```

### 4. Start backend + dashboard

```bash
./scripts/dev-server.sh
```

This finds free ports (from 3000 and 5173), wires `CORS_ORIGIN` and `VITE_API_URL` to match, and
runs both. Handy when several worktrees are running at once. It prints both URLs on startup.

**Use this rather than starting the two halves separately.** The backend allows exactly one CORS
origin, so if the dashboard lands on a different port than `CORS_ORIGIN` names, every API call
fails in the browser with "Failed to fetch" while `curl` still works. `dev-server.sh` keeps the
two in sync; starting them by hand does not.

If you do run them separately, pass matching values yourself:

```bash
CORS_ORIGIN=http://localhost:5173 pnpm dev:backend
pnpm dev:dashboard   # must actually serve on 5173
```

The dashboard reads `VITE_API_URL` and `VITE_API_KEY` from the **root** `.env` — `vite.config.ts`
sets `envDir: '..'`. There is no `dashboard/src/config.ts`; configuration is env-var only. Use
`pnpm`, not `npm` — this is a pnpm workspace.

### 5. Configure the iOS app

```bash
open "ios/HealthKit Sync/HealthKit Sync.xcodeproj"
cd "ios/HealthKit Sync/HealthKit Sync"
cp Config.example.swift Config.swift
```

Edit `Config.swift` (gitignored):

```swift
static let apiBaseURL = "http://YOUR_MAC_IP:3000"  // ipconfig getifaddr en0
static let apiKey = "YOUR_API_KEY"                 // must match .env
static let historicalImportDays = 90               // raise to backfill further
```

Then connect the iPhone, select it as the destination, ⌘R, and grant HealthKit permissions.

Changing `apiKey` requires a rebuild — the installed app keeps the value it was compiled with
and will return `401` until redeployed.

### 6. Import data

Tap **Import Last N Days** in the app.

Use the historical import rather than **Sync Now** for a fresh or empty database — sync anchors
are cached in iOS `UserDefaults`, and a stale anchor against an empty DB syncs nothing. The
historical import ignores anchors and refetches the whole window.

## Project Structure

```
fitness-extractor/
├── backend/              # Node.js API server
│   ├── src/
│   │   ├── controllers/  # Request handlers
│   │   ├── services/     # Business logic + DB operations
│   │   ├── routes/       # API routes
│   │   ├── db/           # Connection pool (lazy init)
│   │   └── middleware/   # API key auth
│   └── migrations/       # SQL schema
│
├── dashboard/            # React + Vite + Tailwind
│   └── src/
│       ├── pages/        # Dashboard.tsx
│       ├── components/   # WorkoutMap.tsx, ActivityRings.tsx
│       ├── api.ts        # Backend client
│       └── types.ts
│
├── ios/HealthKit Sync/   # Swift/SwiftUI app
│   ├── Config.swift              # API config (gitignored)
│   ├── HealthKitService.swift    # HealthKit extraction
│   ├── SyncService.swift         # Sync orchestration + anchors
│   ├── AppDelegate.swift         # Background observers
│   └── APIClient.swift
│
├── scripts/dev-server.sh # Dev launcher with port discovery
└── docs/
    ├── MVP_ARCHITECTURE.md
    ├── DATABASE_SCHEMA.md
    ├── API_SPECIFICATION.md
    └── heatmap-feature/research.md
```

## API Endpoints

### Sync (iOS → backend)

- `POST /api/sync/workouts`
- `POST /api/sync/health-metrics`
- `POST /api/sync/activity-rings`
- `POST /api/sync/anchors`
- `GET  /api/sync/anchors/:userId/:dataType`

### Dashboard (backend → web)

- `GET /api/dashboard/recent`
- `GET /api/workout/:id`
- `GET /api/workout/:id/route`
- `GET /api/activity-rings/:date`
- `GET /api/health-metrics/:metricType`

All require the `X-API-Key` header except `/api/health`.
Source of truth: `backend/src/routes/*.ts` (`docs/API_SPECIFICATION.md` is the Oct 2025 plan).

## Database Schema

8 tables: `workouts`, `workout_routes` (GPS as JSONB + bounding box), `health_metrics`,
`activity_rings`, `workout_annotations` (favorites; keyed on `healthkit_uuid`, no FK),
`sync_anchors`, `users`, `schema_migrations`.

Duplicate handling is via `ON CONFLICT` — `healthkit_uuid` for workouts and metrics,
`(user_id, date)` for rings, `(user_id, data_type)` for anchors.

Source of truth: `backend/migrations/*.sql`. `scripts/nas/migrate.sh` applies pending
`NNN_*.sql` on every deploy (`docs/DATABASE_SCHEMA.md` is the Oct 2025 plan).

## Development

```bash
pnpm lint        # Biome across the workspace
pnpm lint:fix
pnpm build       # compile all packages
```

Biome config is the root `biome.json` — packages inherit it.

Backend notes: ESM (`"type": "module"`), so imports use `.js` extensions even for `.ts` sources.
`.env` is loaded from the project root **before** any module that reads env vars, and the DB pool
is lazily initialised via `getPool()` for the same reason.

### Test fixtures

```bash
curl -X POST http://localhost:3000/api/sync/workouts \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d @backend/test-workout.json
```

Other fixtures: `test-health-metrics.json`, `test-activity-rings.json`, `test-sync-anchors.json`
and their `-update` variants, in `backend/`.

### Worktrees

Use Claude Code's built-in worktree support. Run `./scripts/dev-server.sh` inside the worktree —
it picks non-conflicting ports automatically, so several worktrees can run side by side.

## Deployment

Currently local-network only: iPhone and backend must share a WiFi network.

NAS deployment is not done yet — `docker-compose.yml` still has the `backend` and `dashboard`
services commented out. See `ROADMAP.md` Phase 4.

## Troubleshooting

### iOS

- *"Local network prohibited"* — grant local network permission in iOS Settings
- *"Authorization not determined"* — grant HealthKit permissions in Settings → Privacy
- *Sync fails* — check the backend is running, the iPhone is on the same network, and
  `apiBaseURL` matches your current Mac IP (it changes between networks)
- *Sync reports 0 records* — stale local anchors; use the historical import instead

### Backend

- *DB connection fails* — `docker ps` to confirm `fitness-db` is up
- *Port in use* — use `./scripts/dev-server.sh`, or change `PORT`
- *Startup exits immediately* — `DB_PASSWORD` or `API_KEY` missing from root `.env`

### Database

```bash
# Health check
docker exec fitness-db psql -U postgres -d fitness -c "SELECT NOW();"

# Row counts
docker exec fitness-db psql -U postgres -d fitness -c "
SELECT 'workouts' AS t, COUNT(*) FROM workouts
UNION ALL SELECT 'workout_routes', COUNT(*) FROM workout_routes
UNION ALL SELECT 'health_metrics', COUNT(*) FROM health_metrics
UNION ALL SELECT 'activity_rings', COUNT(*) FROM activity_rings;
"
```

## Security Notes

- **Never commit** `Config.swift` or `.env` — both are gitignored
- Generate keys with `openssl rand -base64 32`
- `API_KEY` in `.env` and `apiKey` in `Config.swift` must match
- Keep real keys out of docs and handover notes — this repo is public, and a key was leaked that
  way once already (rotated 2026-08-19)
- Single-user personal project; not designed for multi-user use

## License

MIT.
