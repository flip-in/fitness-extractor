# Fitness Extractor - Roadmap

**Started:** 2025-10-11
**Last active:** 2026-01-22
**Resumed:** 2026-08-19
**Current state:** Deployed on the NAS (ceres) 2026-09-08 with the full 1100-day history; phone
points at it; background-only sync build installed. 2026-09-09: the nightly task is dead by iOS
design (HealthKit locked with the phone); all tiers + metric history backfill now ride on the
hourly observer wakes. Remaining Phase 4 chores below, then sleep/workout extras, then heatmap.

---

## 2026-09-09 — the nightly task can never read HealthKit; everything rides on wakes

**Found** (12h unified-log archive, morning of 09-09): the NAS had no POSTs 00:10→07:34 CEST
and the slow-tier types had no rows for the day. dasd *did* launch
`com.williamprice.HealthKit-Sync.nightly-sync` 17 times (every ~30 min, on charger, 00:40→10:57
CEST). Every run failed in ~50 ms with HealthKit error 6 "Protected health data is
inaccessible", then 50 route attempts failed the same way. HealthKit is unreadable while the
phone is passcode-locked, and dasd's Device Activity Policy only runs processing tasks while
the phone is idle (`deviceActive == 0`), i.e. locked. The two never overlap. Observer wakes
also pause while locked (that's the overnight gap). So **HealthKit observer wakes are the only
background execution with HealthKit access**, ~hourly, 30s each, only while the phone is unlocked.

**Decision (user, "option 1"):** every tier and the history backfill ride on observer wakes.

- Wake order now: workouts → rings → fresh route → hot (+workout) tier → ≤3 routes → **3 types
  of the workout+slow pool round-robin** (`slowTierCursor`, advanced before the fetch so a
  suspended wake moves on) → **history backfill pages** while >6s of budget remain. Sync Now
  (unbounded) still does all tiers, then backfill to completion.
- `Tier.nightly` renamed `Tier.slow`. Pool of ~37 types → one rotation every ~12 wakes. The
  workout tier is in the pool (pi review): VO2max / HR recovery / form samples land after the
  wake that synced the workout and would otherwise wait for the next workout.
- pi review also caught: backfill "done" must count deleted objects (the query limit includes
  them); a per-type failure (bad unit, HTTP 207) must not block the types after it — only a
  locked store or a network error stops the pass; an *empty first page* may be an ungranted
  read type (HealthKit answers denial with nothing, and the app is never opened to accept the
  prompt) so it is retried daily instead of flagged done; a failed route is demoted to the back
  of the queue so a poison route can't head every wake (the loop's `break` also only left the
  `switch` — now `break pass`).
- **History backfill (step 4 below):** per type a second anchor `backfill.<id>` over the fixed
  predicate `start < 2026-09-09T00:00Z` (fixed predicate + anchor is safe; the earlier bug was a
  *moving* predicate), 5000 rows/page, anchor saved per page, `backfill.done.<id>` on a short
  page. Order hot → workout → slow. One-day overlap and the already-complete types page through
  as server-side duplicates (0.1s/5000). Stops at the first error (lock/network fails every type).
  Expect ~1–2M rows ≈ 200–400 pages at ~1–2 pages per wake: weeks, accepted ("slow is fine").
- `isProtectedDataAvailable` guard in `performFullSync` and `performNightlySync`: one 🔒 log
  line instead of 51 errors. The BGProcessingTask stays scheduled as an opportunistic bonus.
- `pendingRoutes` in the UI is not observable without opening the app; the NAS
  `workout_routes.created_at` and the wake POST sizes (0.2–2.5 MB = route re-POSTs) are the check.

**Verify (09-09/10):** each wake's log shows `🔁 Slow tier a–b/23` and `📜 Backfill: N pages`;
slow types (RestingHR, HRV, SpO2, RespiratoryRate, wrist temp, …) gain rows through the day;
`min(start_date)` of HeartRate/StepCount/ActiveEnergy moves back over the days.

**Verified 09-09 afternoon (NAS log + DB, app never opened):** wakes at 12:38, 13:40, 15:27 CEST
(gaps 62 / 107 min). 13:40 and 15:27 each ran hot → route re-POSTs → 3 rotation types →
6–7 backfill pages inside the budget; 65k HeartRate rows backfilled so far
(2025-05-13 → 2025-09-02, anchor order ≈ insertion order, older years follow). Rings 144 kcal /
8 stand hours at 15:27 matched the watch. Route queue: 3 → 2 duplicate re-POSTs per wake.

### 09-09 chores (branch `worktree-chores-c`)

- iOS: `totalEnergyBurned` → `statistics(for: activeEnergyBurned).sumQuantity()` (iOS 18
  deprecation), falling back to the legacy total via a protocol indirection because the NAS
  has 97 workouts from iPhone apps (perfect10, JEFIT) that may predate the workout builder and
  carry no statistics; `urlCache = nil` + `reloadIgnoringLocalCacheData` on the API session (CFNetwork
  Cache.db noise in background wakes); the two Swift 6 isolation warnings (`ExpirationFlag`,
  `wakeBudget`) → build has zero warnings. Not installed on the phone yet (install after merge).
- Backend: successful `GET /api/health` no longer logged (compose healthcheck every 30s) and
  `Database connected` logs once, not per pooled client — together they were most of the log.
- **Migration runner** `scripts/nas/migrate.sh`: receive-deploy now does `compose up --wait db`
  → apply every `NNN_*.sql` whose version has no `schema_migrations` row (in one transaction
  each, the version row inside that same transaction) → pin `TAG` → `compose up` app; a failed
  migration leaves the old app and its tag in place and fails the deploy. pi review round 1
  (4 findings, all fixed): version row + file in one transaction; rollbacks skip migrations
  (a failing migration must not block rolling back from it); DB readiness probed over TCP
  (`pg_isready -h localhost`, also in both compose healthchecks) because on a fresh volume the
  socket-only init server answers while initdb.d is still applying 001–003; the wait is
  bounded (120s) so a dead DB fails the forced-command session instead of hanging it; the
  bundle's `migrations/` replaces the NAS copy instead of overlaying it. Round 2 (1 finding,
  fixed): the `docker-entrypoint-initdb.d` mount is gone from the NAS compose, so a fresh volume
  is also migrated by the runner instead of by the entrypoint outside any transaction. Tested
  against the laptop DB: apply, a deliberately failing file (no version row left behind),
  no-op re-run, connection failure refused. First NAS run will insert the version-2 row for the
  already-seeded user; nothing else pending. Hand-applying SQL before a deploy is over.
- Removed `dashboard/eslint.config.js` (Biome lints; eslint not installed) and the Vite
  template `dashboard/README.md`. `docs/` trio marked historical (banner + pointers to the SQL,
  routes and ROADMAP); root README / CLAUDE.md point at the code instead.
- Still open from list C: `fetchWorkouts` unbounded (metadata only, low priority); wake budget
  20s → ~24s needs a look at the tail of a wake in the phone log first.

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
~~`totalEnergyBurned` iOS 18 deprecation and `urlCache = nil` noise fix still deferred.~~ Done 09-09.

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
# laptop dev DB: apply the schema by hand (the NAS gets scripts/nas/migrate.sh on deploy)
scripts/nas/migrate.sh backend/migrations docker exec -i fitness-db psql -U postgres -d fitness
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
- [x] **Favorites** (2026-09-08): heart on each card + "♥ Favorites" toggle that swaps the list
  for **all-time** favorites (`GET /api/dashboard/favorites`, ignores the day range).
  `PUT /api/workout/:id/favorite {is_favorite}`. Stored in the new
  `workout_annotations` table (`003_workout_annotations.sql`), keyed on `healthkit_uuid` with
  **no FK** so a wipe + re-import keeps them; future tags/notes/immich photo links go there too.
  Was hand-applied on the NAS 09-08; since 09-09 `receive-deploy.sh` runs `migrate.sh` for
  pending migrations on every deploy.
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

`health_metrics` is generic (`metric_type/value/unit`), so quantity types are one table line each.

1. [x] **Quantity types** — done 2026-09-08. `ios/.../HealthMetricTypes.swift` is the single table
   (identifier → `HKUnit`, 43 types: heart, vitals, body, activity totals, running/cycling/walking
   form, hearing). It drives `readTypes`, the anchored fetch, anchor keys (`anchor.<identifier>`,
   legacy `heartRateAnchor`/`stepCountAnchor` read as fallback) and the backend `metric_type`.
   Per-type errors are isolated (one failing type no longer aborts the rest); anchors are saved
   only after the POST succeeds **with zero rejected rows** (HTTP 207 used to advance the anchor
   past failed rows — pre-existing bug, fixed); a wrong unit fails that type's fetch (anchor kept)
   instead of crashing.

   **Same-day fixes, from the phone's unified log** (`sudo log collect --device-name` then
   `log show --predicate 'process == "HealthKit Sync"'` — the app's `print`s are *not* in it, only
   HealthKit's own `com.apple.HealthKit:query` lines, which name each type and its timing):
   - An observer wake is a **30s dasd window** (`com.apple.healthkit.background-delivery.<bundle>`,
     "Utility, 60s … runtime limit 180" but the process was suspended at +31s). Anchored queries
     take **1–7s each** in the background regardless of sample count (AppleExerciseTime 7s,
     AppleStandTime 4s, HRV 3.6s), so 43 serial queries never finished: the 10:41 CEST wake was
     suspended at type 41 and rings — which ran last — never POSTed (dashboard stuck at 115 kcal).
     Fix (user decision, 2026-09-08): metric types are **tiered** in `HealthMetricTypes`. Every
     wake: workouts → rings → *hot* tier (HR, steps, active energy, walking distance, exercise
     time, stand time; 6 queries, 4 concurrent) → ≤3 routes. A wake that just synced a workout
     adds the *workout* tier (HR recovery, VO2max, physical effort, running/cycling form,
     cycling/swimming distance, strokes). The remaining ~23 slow types are *nightly* only. The
     BGProcessingTask (renamed `NightlySyncTask`, id `…nightly-sync`, always scheduled) runs the
     unbounded all-tier sync + routes on charger; the foreground button does the same.
     `SyncService.wakeBudget` (20s) remains as a safety net, not the mechanism.
   - Anchor + start-date predicate were combined; with an anchor the predicate is dropped. The
     old query excluded samples whose start time predates the last sync, i.e. everything the watch
     delivers late (most of a workout's HR series). Anchor-only now.
   - ~~Deferred: `HKObjectQueryNoLimit` still materialises the whole backlog~~ — paged 2026-09-08:
     `syncMetricType` fetches `metricPageSize` (5000) per anchored query, POSTs, saves the anchor,
     repeats until a short page or the wake budget runs out. Workouts fetch is still unbounded
     (metadata only, small). **Trigger, seen on the NAS 15:15 CEST:** AppleExerciseTime holds
     47,679 rows spanning 2022-05-29 → 2025-09-02 and *nothing newer*; latest created_at 11:13Z.
     The anchor-only query returned the phone's whole history for that type (likely: anchors are
     a row watermark and history restored from iCloud sits above it — unproven; VO2Max and
     HeartRateRecovery also came back from 2021/2022, DistanceCycling and PhysicalEffort from
     today only, so the pattern is per type and not understood), the
     8 MB batches were cut off by the 30s suspension, the anchor never advanced, and every later
     wake re-fetched the same 47k rows and stalled again (12:09Z and 13:51Z wakes: rings + 5 hot
     POSTs each, no ExerciseTime). Paging + per-page anchor turns that into steady progress across wakes.
     Side effect worth keeping: this *is* the metric backfill (step 4) arriving for free.
     **Confirmed working 16:12 CEST** from the unified log (`logSync` lines): 5 pages/run, page 5
     of the second run shipped 2321 new rows past 2025-09-02.
   - **Sync Now was a silent no-op after launch** (found 16:12 CEST): HealthKit fires every
     observer when the app launches, so a 20s-budget observer sync is already running when the
     button is tapped and `performFullSync` bails on `isSyncing`. Fix (user: "A"):
     `performForegroundSync()` waits for the in-flight run, then runs unbounded; the button is
     disabled by `foregroundSyncRequested` instead of `isSyncing`.
   - **Budgeted runs cap paging at 2 pages/type** (`budgetedPageCap`, user decision): a backlog
     took 5 × 4s and starved the other hot types and the end-of-wake route step. Unbounded runs
     still page to the end. This is also why the lunchtime ride's route (queued by the old build,
     not "fresh") stayed pending through two observer runs: the route step never came up.
     (Route landed 16:31 CEST via Sync Now on the new build.)
   - **Backend bulk insert for metrics** (16:40 CEST): the Sync Now run failed with
     `NSURLErrorDomain -1001` on every 5000-row page of *new* rows. `insertHealthMetric` did
     connect/BEGIN/INSERT/COMMIT per row (20k round trips per page, >30s over the NAS); the NAS
     logged 200 after the phone had given up, so anchors never advanced for backlog types.
     `insertHealthMetrics` now does a multi-row `INSERT … ON CONFLICT DO NOTHING` in 1000-row
     chunks, falling back to per-row for a chunk that fails so HTTP 207 still names the bad row.
     Measured locally: 5000 fresh rows 1.5s (was >30s), 5000 dupes 0.1s. Phone request timeout is
     per run: the wake budget (20s) on observer wakes, 120s on unbounded runs (pi review: a
     flat 120s could hold a 30s wake hostage). Observer runs also yield while Sync Now is
     waiting (pi review: a delivery burst could starve it). Empty metrics array returned 500
     (0 === 0); now 200.
     **Needs a NAS deploy** (backend change) — the phone build is already installed.
     Deployed 16:45 CEST, 17/17. A foreground Sync Now then drained the backlog: 361k rows, 34
     types. Types first touched by the anchor-only build got full history (ExerciseTime from
     2021, RespiratoryRate, HeadphoneAudio from 2019, running form from 2022, FlightsClimbed
     from 2018…); types that already had a forward-only anchor (HR, steps, energy, distance,
     stand, HRV, SpO2, resting HR, walking mobility) still have today only → step 4 remains.
   - **Workouts vanished once syncs got healthy** (found 23:50 CEST): `fetchWorkouts` still
     combined the anchor with `start_date ≥ lastSyncDate`. While wakes were failing at the end
     (ExerciseTime timeout) `lastSyncDate` never advanced and this stayed hidden; after the deploy
     every hourly wake succeeded, the predicate moved forward each hour, and two climbing
     sessions + the ride home (started before the previous wake, saved after) were skipped with
     the anchor advancing past them. Fix: anchor-only once an anchor exists (as for metrics);
     the anchor key is renamed `workoutsAnchor.v2` so the next wake starts fresh with a 30-day
     lookback and re-syncs the lost workouts (dedupe on the backend). Nothing to do on the phone.
     **Verified 00:10 CEST 09-09:** first wake on the new build re-sent 30 days of workouts,
     the Climbing (14:39–16:41Z) and the 16.6 km ride home (17:16–18:32Z) appeared, the ride's
     route attached in the same wake (fresh-route-first). Never opened the app.
   - **Routes before metrics in unbounded runs** (user decision 2026-09-09): Sync Now and the
     nightly task drain the whole route queue right after rings, before the all-tier metric
     sweep. The sweep can run for an hour while the backfill lasts and the BGProcessingTask may
     expire inside it; a route step at the end would have starved for nights. Observer wakes are
     unchanged (fresh route → hot tier → ≤3 routes). The nightly log line now reports queue
     entries cleared over the whole run, not just the trailing sweep.
   - **Fresh route first** (user decision 2026-09-08, "option 1"): the 12:09Z wake after the
     morning ride ran rings + hot tier and never reached the end-of-wake route step, so on an
     hourly cadence GPS only ever arrived via the nightly task. Now a queued workout that ended
     within 6h (`RouteBackfillQueue.freshWindow`; end dates persisted alongside the queue) has
     its route fetched right after rings, before metrics. Entries queued before this build
     have no end date and stay on the nightly path. **Verified 2026-09-08 16:06 CEST:** the
     13:36–13:55Z ride landed with `has_route: true` on the first wake after it (workouts →
     rings → route POST → metrics, 11s total).
   - **`print` → `os.Logger`** (2026-09-08, `Log.swift`, `logSync(_:)`): all 34 app log lines now
     land in the unified log at notice level, public privacy, so `log collect` archives show the
     app's own sync narrative (type synced, route attached/dropped, nightly task ran) next to
     HealthKit's query lines. Predicate unchanged: `process == "HealthKit Sync"`.
   New types start **forward-only** from `lastSyncDate` — see step 4. HealthKit prompts for the
   new read types the next time the app calls `requestAuthorization` (one-time grant).
   Observers unchanged (HR/steps/energy/stand/workouts) — every wake syncs all 44 types anyway.
   **Reinstall without launching is safe:** the 14:25 CEST install (fresh-route build) was never
   opened and the 13:51Z observer wake still fired (rings + hot tier on the NAS).
   Installed on the phone 2026-09-08; NAS `health_metrics` had only 12 rows before (HR/steps since
   cutover — the historical import never imported metrics). Verify: distinct `metric_type`s grow.
2. **Sleep** (`HKCategoryTypeSleepAnalysis`): new category-sample fetch; value = stage.
3. **Workout extras**: `workoutActivities`, workout events (laps/pauses), `allStatistics`,
   effort score (iOS 18); route `course` + `verticalAccuracy`. Needs new tables.
4. [x] Historical backfill of **all** metric types — built 2026-09-09 (see the top section):
   per-type `backfill.<id>` anchor over a fixed `start < 2026-09-09` predicate, paged 5000/page
   in the tail of every observer wake (and to completion in Sync Now). Verify over the coming
   days that `min(start_date)` per type walks back to the 2018–2022 first samples.

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
- Workout tags / notes (extend `workout_annotations`)
- Photos ↔ workouts via the immich API (search assets by taken-at inside start/end, GPS bbox
  from the route; store asset id in `workout_annotations`; thumbnails proxied by the backend)
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
