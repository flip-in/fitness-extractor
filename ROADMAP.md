# Fitness Extractor - Roadmap

**Started:** 2025-10-11
**Last active:** 2026-01-22
**Resumed:** 2026-08-19
**Current state:** Deployed on the NAS (ceres) 2026-09-08 with the full 1100-day history; phone
points at it; background-only sync build installed. Remaining Phase 4 chores below, then heatmap.

---

## 2026-09-08 — background-only workout sync

**Goal (user):** never open the app. Everything, including GPS routes, syncs in the background,
even if older routes take days to arrive.

**Why:** a 1100-day import was jetsam-killed *after* completing (code 9, memory). The same
code path — `fetchWorkouts` pulling full GPS routes per workout — also ran on every HealthKit
observer wake, whose memory budget is far below foreground. Hypothesis (not proven): repeated
background kills are why the workout observer has "needed the app opened" since Oct 2025 while
the scalar-sample observers (heart rate, steps) worked.

**What changed:**

- Incremental sync sends workout **metadata only** (`includeRoutes: false`) and queues UUIDs in
  `RouteBackfillQueue` (UserDefaults). Each sync then attaches ≤3 routes, newest first, one
  request each. A nightly `BGProcessingTask` (`RouteBackfillTask`, requires charger + network)
  sweeps the rest. New `Info.plist` carries `UIBackgroundModes: processing` and the task id.
- Backend `insertWorkout`: a duplicate that arrives *with* a route for a row that has none now
  attaches it (reported as `updated`); other duplicates still skip. Verified live: metadata
  POST → `synced 1`, re-POST with route → `updated 1`, third → `skipped 1`, one route row.
- Memory hygiene: `autoreleasepool` around per-workout conversion and each `HKWorkoutRouteQuery`
  chunk; one shared `ISO8601DateFormatter` instead of one per sample/point (~1.9M constructions
  in the full import).
- Historical import (manual, foreground) unchanged: still inline routes, still the one-off tool.

**Not done / to verify on device:** rebuild from Xcode; watch `pendingRoutes` in the UI drop
without opening the app again; confirm `updated` counts on the backend. Force-quitting the app
disables BGTaskScheduler until the next launch — leave it in the switcher.
`totalEnergyBurned` iOS 18 deprecation and `urlCache = nil` noise fix still deferred.

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

**Rebuilt 2026-09-07/08.** After a 1100-day import: 1343 workouts, 944 GPS routes, 1.69M route
points, 846 activity rings, 217k health metrics, spanning 2023-09-03 → 2026-09-08. The 2024-Q1/Q2
workout gap has data on both sides — genuine absence, not truncation. Dashboard verified.

To rebuild again from scratch:

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
- **Raise `historicalImportDays` first.** `Config.swift` defaults to 90. Set it past your
  earliest HealthKit workout, import, then put it back so routine syncs stay cheap. HealthKit
  holds years, so the window is the only limit on how far back you get.
- **Don't judge coverage until the import finishes.** Workouts arrive newest-first across many
  batches, so a mid-import query looks exactly like a device with no older data. Wait for the
  activity-rings POST — it's the last step — before concluding anything is missing.

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

**Former limitation:** workouts "needed the app opened". Suspected cause was the route fetch
blowing the background memory budget; addressed 2026-09-08 (see top). Verify on device.

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

## Phase 4: Deployment — 🟡 Deployed 2026-09-08, cutover pending

Design: `docs/superpowers/specs/2026-09-08-nas-deployment-design.md`. Single `app` image (API +
dashboard same-origin), built on the Mac for amd64 and shipped over a restricted, forced-command
SSH key to `/volume2/docker/fitness-extractor/` on ceres (DS423+). pgdata on the volume2 SSD,
nightly `pg_dump` to `/volume1/homes/Oberon/backups/fitness-extractor/`.

**Deploy:** `./scripts/deploy.sh` (HEAD must equal origin/master). Rollback:
`./scripts/deploy.sh --rollback <tag>`. First deploy `2def805` passed 12/12 smoke checks on an
empty DB; rollback path, backup script, initdb + seed user all exercised on the NAS.

- [x] Dockerfile, `.dockerignore`, `docker-compose.nas.yml`, env-only backend config, SPA serving
- [x] `scripts/deploy.sh`, `scripts/nas/receive-deploy.sh`, `scripts/nas/backup.sh`
- [x] `002_seed_user.sql`; NAS bootstrap; first deploy; backup dry run
- [x] Phone cutover 2026-09-08: `apiBaseURL` → NAS, ATS exception for plain HTTP on 100.x,
  1100-day import → NAS holds 1343 workouts / 944 routes / 1.69M points / 845 rings (matches
  laptop). Smoke 14/14. Observers already delivering metrics to the NAS in background.
- [ ] DSM Task Scheduler: daily 03:00, user Oberon, `bash /volume2/docker/fitness-extractor/backup.sh`, email on error
- [ ] Verify §3.5 remainder: off-LAN dashboard, overnight route backfill (`pendingRoutes` → 0), restore drill
- [ ] Browser homepage → `http://100.121.150.120:3000`
- [ ] Optional: Hyper Backup → the backups folder
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

## Next: collect everything HealthKit has ("health dump") — decided 2026-09-08

Decision: the iOS app should sync **all** available HealthKit data, not a curated subset. What
gets used (dashboard, heatmap, other apps) is decided in the backend/consumers later.

Today only heart rate + step count are synced (`SyncService.syncHealthMetrics`), though
`bodyMass`, `distanceWalkingRunning`, `activeEnergyBurned` are already authorized.
`health_metrics` is generic (`metric_type/value/unit`), so quantity types are ~3 lines each.

1. **Quantity types** (one anchored query each, scalar samples, cheap in background): the three
   above + restingHeartRate, heartRateVariabilitySDNN, walkingHeartRateAverage, vo2Max,
   heartRateRecoveryOneMinute, oxygenSaturation, respiratoryRate, appleSleepingWristTemperature,
   basalEnergyBurned, appleExerciseTime, appleStandTime, flightsClimbed, distanceCycling,
   distanceSwimming, timeInDaylight, running{Power,Speed,StrideLength,VerticalOscillation,
   GroundContactTime}, cycling{Power,Cadence,Speed,FunctionalThresholdPower},
   walking{Speed,StepLength,AsymmetryPercentage,DoubleSupportPercentage}, appleWalkingSteadiness,
   sixMinuteWalkTestDistance, environmentalAudioExposure, headphoneAudioExposure.
   Table-drive it: one `[HKQuantityTypeIdentifier: HKUnit]` map replaces `preferredUnit` and the
   per-type anchor keys. Anchors keyed by identifier string.
2. **Sleep** (`HKCategoryTypeSleepAnalysis`): new category-sample fetch; value = stage.
3. **Workout extras**: `workoutActivities`, workout events (laps/pauses), `allStatistics`,
   effort score (iOS 18); route `course` + `verticalAccuracy`. Needs new tables.
4. Historical backfill of the new types: raise `historicalImportDays` once more, or extend the
   import to cover metrics (today it imports workouts + rings only).

Watch: HR-frequency series grow `health_metrics` fast (217k rows/yr for HR alone). Fine on the NAS.

## Then: GPS Heatmap

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
- ~~Background App Refresh for more reliable workout sync~~ — BGProcessingTask landed 2026-09-08
- Historical import could reuse the metadata-first + queue path to cut its peak memory
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
- [x] M6 Deployed to NAS via Tailscale — 2026-09-08
- [ ] M7 Runs a week unattended
