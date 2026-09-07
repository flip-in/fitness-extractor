# Fitness Extractor - Roadmap

**Started:** 2025-10-11
**Last active:** 2026-01-22
**Resumed:** 2026-08-19
**Current state:** Backend + iOS + dashboard all working. Database wiped. Next feature: GPS heatmap.

---

## ⚠️ Resuming after the 2026-01-22 → 2026-08-19 gap

Read this first. Three things changed while the project sat idle.

### 1. New computer — the database never existed here

Work moved to a new Mac. The repo came across; Docker images/volumes and the Xcode account did
not. So there's no `fitness-db` container, no `postgres:16` image, no `postgres_data` volume,
and Xcode has no signing identity.

Nothing was lost that matters: the old DB only ever held a 90-day window imported in Oct 2025,
and HealthKit on the iPhone is the source of truth for all of it. A fresh import is strictly
better than restoring the old volume would have been — no reason to chase the old machine.

To rebuild:

```bash
docker compose up -d db
# no migration runner exists — apply the schema by hand:
docker exec -i fitness-db psql -U postgres -d fitness < backend/migrations/001_initial_schema.sql
pnpm install && ./scripts/dev-server.sh
```

(`docker-compose.yml` has an `initdb.d` mount commented out that would automate this — worth
uncommenting so a fresh volume self-migrates.)

Then re-import from the iOS app. **Two gotchas:**

- **Use "Import Last N Days", not "Sync Now".** Sync anchors are cached in iOS `UserDefaults`
  (`SyncService.swift:232-255`). A stale anchor against an empty DB syncs nothing and looks
  broken. Historical import passes `anchor: nil` (`SyncService.swift:103`) and bypasses this.
- **90 days is not enough.** `Config.swift:28` has `historicalImportDays = 90`, which today
  only reaches back to May 2026. The wiped DB held data from roughly **mid-July 2025** — the
  Oct 2025 import was itself a 90-day window — so ~400 days is needed to match it, and more to
  go further. Set the constant past your earliest HealthKit workout rather than to a fixed
  number, import, then put it back to 90 so routine use stays cheap.

### 2. API key was rotated (2026-08-19)

The old key was committed in plaintext in `SESSION_HANDOVER.md` (public repo) and was still
live. New key is in `.env` and `ios/.../Config.swift`. `SESSION_HANDOVER.md` deleted.
The dead string remains in git history — harmless, but don't reuse it.
DB password rotated at the same time (local dev only).

**The iPhone still has the old key compiled in.** `Config.swift` was edited on disk, but the
installed app was built from the old value and will get `401`s until rebuilt and redeployed
from Xcode. Do that before troubleshooting any sync failure.

### 3. Worktree shell scripts removed

`scripts/create-worktree.sh` and `scripts/worktree-setup.sh` are gone, replaced by Claude Code's
worktree tooling. `scripts/dev-server.sh` (auto-port-finding dev launcher) is still there and
still the way to run things.

### Still unverified

`docs/MVP_ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md` and `docs/API_SPECIFICATION.md` are all
untouched since 2025-10-11 and were **not** checked against the code during the 2026-08-19
cleanup. Endpoint paths in the two READMEs *were* verified against `backend/src/index.ts`.
Treat the `docs/` trio as probably-stale until confirmed.

---

## Phase 1: Backend Foundation — ✅ Complete

2025-10-11

- [x] PostgreSQL 16 via Docker, 7 tables, 26 indexes
- [x] Node.js + Express + TypeScript (strict), Biome
- [x] API key auth middleware
- [x] Sync endpoints: workouts, health metrics, activity rings, sync anchors
- [x] Dashboard endpoints: recent, workout detail, workout route, activity rings, health metrics

## Phase 2: iOS App — ✅ Complete

2025-10-15

- [x] Xcode project, HealthKit entitlements + background delivery
- [x] `HKAnchoredObjectQuery` incremental sync, GPS route extraction
- [x] `HKObserverQuery` background observers — workouts, heart rate, steps
- [x] Move/stand ring observers (`activeEnergyBurned`, `appleStandHour`) — merged 2026-08-19
- [x] Manual sync + configurable historical import UI
- [x] Activity types incl. surfing, skateboarding, climbing

**Known limitation:** iOS deprioritises the workout observer. Health metrics sync passively;
workouts generally need the app opened. Accepted for personal use.

## Phase 3: Web Dashboard — 🟡 7/8

2026-01-16 → 2026-01-22

- [x] React 19 + Vite + TypeScript + Tailwind 4
- [x] Layout — single page, `App.tsx` renders `<Dashboard />`
- [x] Recent workouts list with day-range selector (7/30/90)
- [x] Mapbox GL 3.15 route visualisation (`WorkoutMap.tsx`)
- [x] Activity rings component
- [x] API client integration (`api.ts`)
- [x] Styling and polish — click-to-open workout modal, click-outside-to-close, cursor affordances
- [ ] **Dockerize dashboard** — the one outstanding item

**Note:** `react-router-dom` is installed but unused. Either wire it up (needed for the heatmap
page) or drop the dependency.

**Fixes landed 2026-01-21/22:** heart rate aggregation, timezone display.

## Phase 4: Deployment — ⏳ Not started

`docker-compose.yml` still has the `backend` and `dashboard` services commented out. That's the
blocker for everything here.

- [ ] Uncomment + build backend and dashboard services
- [ ] Deploy to Synology NAS via Docker Compose
- [ ] Tailscale access
- [ ] Point iOS `apiBaseURL` at the NAS Tailscale IP (currently a LAN IP that changes)
- [ ] End-to-end test, then run the full historical import
- [ ] Set browser homepage to dashboard

## Phase 5: Iteration — ⏳ Not started

- [ ] Sync reliability monitoring
- [ ] Error handling + logging
- [ ] Performance

---

## Next feature: GPS Heatmap

Research is done and now on `master`: **`docs/heatmap-feature/research.md`**.

**Vision:** full-screen dark Mapbox world map centred on browser geolocation, all GPS workouts
as a density heatmap colour-coded by activity (cycling orange/red, running blue/purple, walking
green). 70/30 split with a workout sidebar; clicking a workout pans/zooms to its bounds and
draws that route as a bright line overlay.

**Approach:** Option A — native Mapbox heatmap layers, one per activity type, plus a line layer
for the selected route. Handles 400k+ points at 60fps.

**Work:** new `GET /api/heatmap/points` endpoint (SQL in the doc); new `HeatmapView.tsx`; a
`/heatmap` route — which is what `react-router-dom` was installed for.

**5 open questions** in the doc's *Unresolved Questions* section: point sampling strategy,
sidebar pagination, layer blending, mobile layout, client-side caching.

---

## Backlog

- Sleep tracking (`HKCategoryTypeSleep`)
- Background App Refresh for more reliable workout sync
- Local notifications as sync reminders
- Data export
- Multi-user support

---

## Milestones

- [x] M1 Backend stores HealthKit data
- [x] M2 iOS syncs workouts
- [x] M3 Dashboard displays workouts
- [x] M4 GPS routes render on map
- [x] M5 Background sync working (health metrics)
- [ ] M6 Deployed to NAS via Tailscale
- [ ] M7 Runs a week unattended
