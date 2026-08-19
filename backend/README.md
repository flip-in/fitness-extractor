# Fitness Extractor — Backend

Express + PostgreSQL API. Receives HealthKit data from the iOS app, serves the web dashboard.

Setup, environment variables and endpoint lists live in the [root README](../README.md). This
file covers backend-specific detail only.

## Layout

```
src/
├── index.ts          # Entry point — loads .env, then imports everything else
├── db/pool.ts        # Lazy connection pool via getPool()
├── middleware/auth.ts
├── routes/           # sync, dashboard, workout, activityRings, healthMetrics
├── controllers/      # syncController, dashboardController
└── services/         # workout, healthMetrics, activityRings, syncAnchors, dashboard
migrations/
└── 001_initial_schema.sql
```

## Two ordering constraints

Both exist for the same reason and both will break subtly if violated:

1. **`.env` is loaded before any import that reads env vars.** `src/index.ts` calls
   `dotenv.config()` against the project root `.env` *first*, validates `DB_PASSWORD` and
   `API_KEY`, and only then imports Express and the pool.
2. **The pool is lazy.** Use `getPool()` at call time; never a module-level instantiated pool.
   A pool constructed at import time reads env vars that aren't set yet.

The API key is likewise checked at request time in the middleware, not at module load.

## Conventions

- ESM (`"type": "module"`) with `"module": "NodeNext"` — **imports need `.js` extensions** even
  though sources are `.ts`
- TypeScript strict mode
- Biome, configured in the root `biome.json`
- All writes run in a transaction: `BEGIN` → work → `COMMIT`, `ROLLBACK` on error,
  `client.release()` in `finally`
- JSON body limit is raised to 50MB — large GPS routes reach a couple of thousand points

## Deduplication

| Table | Conflict target | Action |
|---|---|---|
| `workouts` | `healthkit_uuid` | `DO NOTHING` |
| `health_metrics` | `healthkit_uuid` | `DO NOTHING` |
| `activity_rings` | `(user_id, date)` | `DO UPDATE` |
| `sync_anchors` | `(user_id, data_type)` | `DO UPDATE` |

## Response codes

| Code | Meaning |
|---|---|
| 200 | all records succeeded |
| 207 | partial success — see `errors[]` |
| 400 | validation failed |
| 404 | not found (GET only) |
| 500 | all failed / internal error |

Sync responses carry `{ success, synced, skipped, updated, errors }`.

## Migrations

No runner exists. Apply by hand from the project root:

```bash
docker exec -i fitness-db psql -U postgres -d fitness < backend/migrations/001_initial_schema.sql
```

Naming is `###_description.sql`; applied versions are recorded in `schema_migrations`.
`docker-compose.yml` has a commented-out `initdb.d` mount that would automate this for a fresh
volume.

## Commands

```bash
pnpm dev        # tsx watch
pnpm build      # tsc
pnpm start      # node dist/index.js
pnpm lint       # biome check src/
pnpm lint:fix
```

Run from the project root, `./scripts/dev-server.sh` starts backend and dashboard together on
free ports.

## Test fixtures

`test-workout.json`, `test-workout-today.json`, `test-health-metrics.json`,
`test-activity-rings.json`, `test-sync-anchors.json` and `-update` variants.

```bash
curl -X POST http://localhost:3000/api/sync/workouts \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d @test-workout.json
```

No automated test suite yet — `pnpm test` is a stub.

## Not yet done

- Rate limiting, request size validation, input sanitisation
- Structured error logging
- Dockerised deployment — the `backend` service in `docker-compose.yml` is still commented out
