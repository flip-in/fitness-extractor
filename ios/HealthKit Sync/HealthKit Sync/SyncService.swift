//
//  SyncService.swift
//  HealthKit Sync
//
//  Orchestrates syncing between HealthKit and backend
//

import Foundation
import HealthKit
import Combine
import UIKit

@MainActor
class SyncService: ObservableObject {
    static let shared = SyncService()

    @Published var isSyncing = false
    @Published var lastSyncDate: Date?
    @Published var syncStatus = "Not synced"
    @Published var syncError: String?
    @Published var pendingRoutes = RouteBackfillQueue.shared.count
    /// True from a Sync Now tap until its unbounded run finishes (including
    /// the wait for an in-flight observer sync). Drives the button's disabled state.
    @Published var foregroundSyncRequested = false

    private let healthKit = HealthKitService.shared
    private let api = APIClient.shared
    private let routeQueue = RouteBackfillQueue.shared

    // UserDefaults keys for storing anchors
    /// `.v2` (2026-09-08): the v1 anchor had been advanced past workouts the old
    /// anchor+predicate query skipped, so it is abandoned. The first run with no v2
    /// anchor re-fetches `workoutLookbackDays` of workouts (backend dedupes by UUID)
    /// and picks up the ones that were lost, without anyone opening the app.
    private let workoutsAnchorKey = "workoutsAnchor.v2"

    /// First-fetch window for workouts when there is no anchor. Generous on purpose:
    /// workouts are few and metadata-only, and duplicates are skipped server-side.
    private static let workoutLookbackDays = 30
    private let lastSyncDateKey = "lastSyncDate"
    /// Wall-clock safety net for a HealthKit observer wake. Measured on device
    /// 2026-09-08: dasd grants a 30s activity window, then suspends the process
    /// mid-query. Anchored queries take 1–7s each in the background. The tiering
    /// in `HealthMetricTypes` is what keeps a wake short; this only stops a slow
    /// one from being suspended mid-route.
    static let wakeBudget: TimeInterval = 20

    /// Metric types fetched at once. HealthKit's per-query latency dominates,
    /// not sample volume, so a few in flight cuts wall time ~4x; kept small so
    /// peak memory stays a handful of small sample arrays.
    private static let metricConcurrency = 4

    /// Samples per anchored fetch + POST. Query latency in the background is
    /// 1–7s regardless of size, so pages only matter for a backlog; 5000 rows
    /// is ~3.5 days of per-minute samples and a few hundred KB per POST.
    private static let metricPageSize = 5000

    /// Pages per type per *budgeted* run (observer wake). Seen 2026-09-08: an
    /// ExerciseTime backlog took 5 pages × 4s and ate the whole 20s wake, so the
    /// other hot types and the route step never ran. Two pages (~8s) leaves room;
    /// unbounded runs (Sync Now, nightly) page to the end. Decision: user, 2026-09-08.
    private static let budgetedPageCap = 2

    /// Non-hot types synced per observer wake, round-robin (`rotationCursorKey`)
    /// over the workout + slow tiers, after the hot tier and the route step.
    /// Observer wakes are the only background execution that can read HealthKit
    /// (the store is locked with the phone; the on-charger BGProcessingTask only
    /// runs while locked — see `NightlySyncTask`), so the ~37 non-hot types have
    /// to trickle through wakes: 3 per wake at 1–7s each is one concurrency
    /// chunk, ~12 wakes per rotation. The workout tier is in the rotation too
    /// (pi review): VO2max, HR recovery and form samples land after the wake
    /// that synced the workout, and would otherwise wait for the next workout.
    /// Decision: user, 2026-09-09 ("option 1").
    static let rotationTypesPerWake = 3
    private let rotationCursorKey = "slowTierCursor"

    /// History backfill (ROADMAP step 4). Types that had a forward-only anchor
    /// before the anchor-only build hold rows from the 2026-09-08 cutover only.
    /// Each type gets a second anchor (`backfillAnchorKey`) over a *fixed*
    /// predicate `start < backfillCutoff`, paged like the live sync, and a done
    /// flag once a short page comes back. The cutoff overlaps the live data by a
    /// day; the backend skips duplicates by UUID (0.1s per 5000). Types that
    /// already have full history page through as duplicates once.
    /// Runs after everything else in a wake, and to completion in Sync Now.
    private static let backfillCutoff = ISO8601DateFormatter().date(from: "2026-09-09T00:00:00Z")!

    /// A backfill page is a 1–7s query plus a ~1.5s POST; don't start one with
    /// less than this left in the wake or the suspension at +30s wastes it.
    private static let backfillPageReserve: TimeInterval = 6

    /// Pre-table anchor keys (2025-10 → 2026-09). Read once as a fallback so the
    /// first run after upgrading doesn't re-fetch HR/steps from `lastSyncDate`.
    private let legacyAnchorKeys: [HKQuantityTypeIdentifier: String] = [
        .heartRate: "heartRateAnchor",
        .stepCount: "stepCountAnchor",
    ]

    private init() {
        // Load last sync date
        if let date = UserDefaults.standard.object(forKey: lastSyncDateKey) as? Date {
            self.lastSyncDate = date
            self.syncStatus = "Last synced: \(Self.formatDate(date))"
        }
    }

    // MARK: - Public Sync Methods

    /// `budget`: seconds before the metric pass stops and defers the rest to the
    /// next wake. Observer wakes pass `wakeBudget`; the foreground button and the
    /// nightly task pass nil (unbounded, the task has its own expiration flag).
    ///
    /// `allMetrics`: sync every metric type. Wakes pass false and get only the
    /// hot tier, plus the workout tier when this wake synced a new workout —
    /// see `HealthMetricTypes.Tier`.
    /// Sync Now. HealthKit fires every observer the moment the app launches, so
    /// right after opening the app a budgeted observer sync is usually already
    /// running and a plain `performFullSync` call was a silent no-op (2026-09-08:
    /// two taps, two 20s observer runs, no route step). Wait it out, then run
    /// unbounded. Main-actor: no suspension between the check and the run, so an
    /// observer can't slip in between.
    func performForegroundSync() async {
        guard !foregroundSyncRequested else { return }
        foregroundSyncRequested = true
        defer { foregroundSyncRequested = false }

        while isSyncing {
            syncStatus = "Waiting for background sync to finish…"
            try? await Task.sleep(for: .seconds(1))
        }
        await performFullSync(budget: nil, allMetrics: true)
    }

    func performFullSync(budget: TimeInterval? = SyncService.wakeBudget, allMetrics: Bool = false, shouldContinue: @escaping () -> Bool = { true }) async {
        guard !isSyncing else {
            if Config.debugLogging {
                logSync("⏭️ Sync already in progress, skipping")
            }
            return
        }
        // A budgeted (observer) run yields while Sync Now is waiting its turn:
        // otherwise a burst of HealthKit deliveries can keep grabbing the slot
        // during the 1s poll gap. The unbounded run covers everything anyway.
        if budget != nil && foregroundSyncRequested {
            if Config.debugLogging {
                logSync("⏭️ Observer sync yielding to Sync Now")
            }
            return
        }
        // HealthKit is unreadable while the phone is locked (error 6, "Protected
        // health data is inaccessible"). Every query would fail; say so once.
        guard UIApplication.shared.isProtectedDataAvailable else {
            logSync("🔒 Phone locked, HealthKit unreadable; skipping this run")
            return
        }

        isSyncing = true
        syncError = nil
        syncStatus = "Syncing..."
        api.requestTimeout = budget ?? 120

        let deadline = budget.map { Date(timeIntervalSinceNow: $0) }
        let withinBudget: () -> Bool = {
            shouldContinue() && (deadline.map { Date() < $0 } ?? true)
        }

        do {
            // Test backend connection first
            let isHealthy = try await api.healthCheck()
            if !isHealthy {
                throw NSError(domain: "Backend", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: "Backend health check failed"
                ])
            }

            // Sync workouts (metadata only; routes queue up for backfill)
            let newWorkouts = try await syncWorkouts()

            // Rings before metrics: they are the most visible thing on the
            // dashboard and one cheap query; a metric failure or the budget
            // running out must not cost the rings update.
            try await syncActivityRings()

            // A route for a workout that ended in the last few hours goes ahead
            // of the metric tiers: on a ~hourly wake cadence the tiers use up the
            // budget and the end-of-wake route step never runs, so without this
            // a ride's GPS waits for the nightly task. One route, a few seconds;
            // hot-tier HR/steps lag one wake on ride days, which they do anyway.
            if withinBudget(), let fresh = routeQueue.freshest(within: RouteBackfillQueue.freshWindow) {
                _ = await attachRoute(fresh)
            }

            // Unbounded runs (Sync Now, nightly) drain the whole route queue here,
            // before the metric sweep: routes are few and finite, the metric backlog
            // can run for an hour and the nightly task may expire inside it, so a
            // route step at the end could starve for nights (user decision 2026-09-09).
            if budget == nil {
                await backfillRoutes(limit: RouteBackfillQueue.perProcessingTaskLimit, shouldContinue: withinBudget)
            }

            // Health metrics: hot tier every wake; workout tier when a workout
            // just landed (its HR recovery, running/cycling series are new);
            // everything when asked (foreground button, nightly task). The slow
            // tier's per-wake rotation runs after the route step, below.
            var tiers: Set<HealthMetricTypes.Tier> = [.hot]
            if newWorkouts > 0 { tiers.insert(.workout) }
            if allMetrics { tiers = [.hot, .workout, .slow] }
            try await syncHealthMetrics(
                HealthMetricTypes.entries(in: tiers),
                maxPages: budget == nil ? Int.max : Self.budgetedPageCap,
                shouldContinue: withinBudget
            )

            // Update last sync date
            let now = Date()
            lastSyncDate = now
            UserDefaults.standard.set(now, forKey: lastSyncDateKey)

            syncStatus = "Last synced: \(Self.formatDate(now))"

            if Config.debugLogging {
                logSync("✅ Full sync completed successfully")
            }
        } catch {
            syncError = error.localizedDescription
            syncStatus = "Sync failed: \(error.localizedDescription)"

            if Config.debugLogging {
                logSync("❌ Sync error: \(error)")
            }
        }

        // Best-effort tail, each step only if time remains — a suspended process
        // mid-fetch just wastes the wake. Order: routes (finite, a few per wake;
        // in unbounded runs this is the trailing sweep for entries the run just
        // queued), then the slow tier's rotation, then history backfill pages
        // until the budget is spent. Errors here are logged, never fatal.
        if withinBudget() {
            _ = await backfillRoutes(limit: RouteBackfillQueue.perSyncLimit, shouldContinue: withinBudget)
        }
        if !allMetrics {
            await syncTierRotation(shouldContinue: withinBudget)
        }
        let canStartPage: () -> Bool = {
            withinBudget() && (deadline.map { $0.timeIntervalSinceNow > Self.backfillPageReserve } ?? true)
        }
        await backfillHistory(shouldContinue: canStartPage)
        NightlySyncTask.schedule()

        isSyncing = false
    }

    /// The next `rotationTypesPerWake` workout/slow-tier types, budgeted like
    /// the hot tier. The cursor advances *before* the fetch so a wake suspended
    /// mid-way moves on instead of retrying the same types forever; anchors make
    /// a skipped type merely late.
    private func syncTierRotation(shouldContinue: @escaping () -> Bool) async {
        let pool = HealthMetricTypes.entries(in: [.workout, .slow])
        guard !pool.isEmpty, shouldContinue() else { return }

        let start = UserDefaults.standard.integer(forKey: rotationCursorKey) % pool.count
        let picked = (0..<min(Self.rotationTypesPerWake, pool.count)).map { pool[(start + $0) % pool.count] }
        UserDefaults.standard.set((start + picked.count) % pool.count, forKey: rotationCursorKey)

        do {
            try await syncHealthMetrics(picked, maxPages: Self.budgetedPageCap, shouldContinue: shouldContinue)
        } catch {
            if Config.debugLogging {
                logSync("❌ Tier rotation: \(error)")
            }
        }
        if Config.debugLogging {
            let names = picked.map { $0.identifier.rawValue.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "") }
            logSync("🔁 Rotation \(start + 1)–\(start + picked.count)/\(pool.count): \(names.joined(separator: ", "))")
        }
    }

    /// Pages pre-cutoff history, one type at a time in tier order (hot first:
    /// HR, steps, energy are what the dashboard shows), each page landing before
    /// its anchor is saved. A locked store or a dead network fails every type
    /// the same way, so those stop the pass; any other error (bad unit, HTTP
    /// 207) is that type's problem and the pass moves on so one broken type
    /// can't block the rest forever (pi review).
    private func backfillHistory(shouldContinue: @escaping () -> Bool) async {
        let ordered = HealthMetricTypes.entries(in: [.hot]) + HealthMetricTypes.entries(in: [.workout]) + HealthMetricTypes.entries(in: [.slow])
        var pages = 0

        for entry in ordered where !UserDefaults.standard.bool(forKey: Self.backfillDoneKey(entry)) {
            guard shouldContinue() else { break }
            do {
                let done = try await backfillType(entry, pages: &pages, shouldContinue: shouldContinue)
                guard done else { break }   // budget ran out mid-type
            } catch {
                if Config.debugLogging {
                    logSync("❌ Backfill \(entry.identifier.rawValue): \(error)")
                }
                if Self.isGlobalFailure(error) { break }
                continue
            }
        }

        if Config.debugLogging && pages > 0 {
            let remaining = ordered.filter { !UserDefaults.standard.bool(forKey: Self.backfillDoneKey($0)) }.count
            logSync("📜 Backfill: \(pages) pages this run, \(remaining)/\(ordered.count) types still to go")
        }
    }

    /// Returns true when the type's history is complete (done flag set), false
    /// when it stopped for budget with more to fetch.
    private func backfillType(_ entry: HealthMetricTypes.Entry, pages: inout Int, shouldContinue: () -> Bool) async throws -> Bool {
        var anchor = loadAnchor(forKey: Self.backfillAnchorKey(entry))
        repeat {
            let page = try await healthKit.fetchHealthMetrics(
                entry, before: Self.backfillCutoff, anchor: anchor, limit: Self.metricPageSize
            )
            pages += 1
            try await postMetrics(page.metrics, for: entry, page: pages, label: "backfill ")
            if let newAnchor = page.newAnchor {
                saveAnchor(newAnchor, forKey: Self.backfillAnchorKey(entry))
            }
            anchor = page.newAnchor
            // Samples + deletions short of the limit = last page. Samples alone
            // would call a full page of mostly deletions "done" (pi review).
            if page.returnedCount < Self.metricPageSize || page.newAnchor == nil {
                UserDefaults.standard.set(true, forKey: Self.backfillDoneKey(entry))
                if Config.debugLogging {
                    logSync("📜 Backfill complete: \(entry.identifier.rawValue)")
                }
                return true
            }
        } while shouldContinue()
        return false
    }

    /// Errors that mean "nothing HealthKit-related will work right now": the
    /// store locked with the phone, or no network. Everything else is per type.
    private static func isGlobalFailure(_ error: Error) -> Bool {
        if error is URLError { return true }
        if case APIError.networkError = error { return true }
        if let hk = error as? HKError, hk.code == .errorDatabaseInaccessible { return true }
        return false
    }

    private static func backfillAnchorKey(_ entry: HealthMetricTypes.Entry) -> String { "backfill.\(entry.identifier.rawValue)" }
    private static func backfillDoneKey(_ entry: HealthMetricTypes.Entry) -> String { "backfill.done.\(entry.identifier.rawValue)" }

    /// The BGProcessingTask body: unbounded full sync (all tiers, backfill to
    /// completion) then as many routes as fit. In practice it never gets to run
    /// with HealthKit readable — see `NightlySyncTask` — so this is opportunistic.
    /// Returns how many queue entries were cleared (routes sent or dropped as
    /// route-less). The queue drains inside `performFullSync` (routes-first);
    /// the trailing sweep only catches entries the sync itself just queued.
    func performNightlySync(shouldContinue: @escaping () -> Bool) async -> Int {
        guard UIApplication.shared.isProtectedDataAvailable else {
            logSync("🔒 Nightly task ran with the phone locked; HealthKit unreadable, nothing to do")
            return 0
        }
        let before = routeQueue.count
        await performFullSync(budget: nil, allMetrics: true, shouldContinue: shouldContinue)
        if shouldContinue() {
            await backfillRoutes(limit: RouteBackfillQueue.perProcessingTaskLimit, shouldContinue: shouldContinue)
        }
        return max(0, before - routeQueue.count)
    }

    /// Attaches GPS routes to workouts already synced without them, newest first.
    ///
    /// One workout per request, so a failure mid-way loses nothing: the queue
    /// entry is only removed after the backend acknowledges. A network error stops
    /// the pass (the rest will still be there next wake); a workout with no route,
    /// or one deleted from HealthKit, is dropped from the queue.
    ///
    /// Returns the number of routes sent.
    @discardableResult
    func backfillRoutes(limit: Int, shouldContinue: () -> Bool = { true }) async -> Int {
        var sent = 0

        for uuidString in routeQueue.next(limit) {
            guard shouldContinue() else { break }

            switch await attachRoute(uuidString) {
            case .sent: sent += 1
            case .dropped: continue
            case .failed: break
            }
        }

        pendingRoutes = routeQueue.count
        return sent
    }

    private enum RouteAttempt { case sent, dropped, failed }

    /// Fetches one queued workout's route and POSTs it. The queue entry is
    /// removed on success, or when HealthKit says there is nothing to send
    /// (no route / workout deleted). Any other error leaves it queued.
    private func attachRoute(_ uuidString: String) async -> RouteAttempt {
        guard let uuid = UUID(uuidString: uuidString) else {
            routeQueue.remove(uuidString)
            pendingRoutes = routeQueue.count
            return .dropped
        }

        do {
            let workout = try await healthKit.fetchWorkoutWithRoute(uuid: uuid)
            let response = try await api.syncWorkouts([workout])
            routeQueue.remove(uuidString)
            pendingRoutes = routeQueue.count

            if Config.debugLogging {
                logSync("🗺️ Route attached for \(uuidString): updated \(response.updated ?? 0), skipped \(response.skipped ?? 0)")
            }
            return .sent
        } catch let error as HealthKitError {
            // noRoute / workoutNotFound: nothing to send, ever.
            routeQueue.remove(uuidString)
            pendingRoutes = routeQueue.count
            if Config.debugLogging {
                logSync("🗺️ Dropped \(uuidString) from route queue: \(error)")
            }
            return .dropped
        } catch {
            if Config.debugLogging {
                logSync("❌ Route attach failed for \(uuidString): \(error)")
            }
            return .failed
        }
    }

    func performHistoricalImport() async {
        guard !isSyncing else { return }

        isSyncing = true
        syncError = nil
        syncStatus = "Importing \(Config.historicalImportDays) days of data..."

        do {
            let startDate = Calendar.current.date(byAdding: .day, value: -Config.historicalImportDays, to: Date()) ?? Date()

            // Import workouts
            let (workouts, workoutsAnchor) = try await healthKit.fetchWorkouts(from: startDate, anchor: nil)
            if !workouts.isEmpty {
                syncStatus = "Importing \(workouts.count) workouts..."
                let response = try await api.syncWorkouts(workouts)
                if Config.debugLogging {
                    logSync("📊 Historical workouts: synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
                }
            }

            // Save anchor
            if let anchor = workoutsAnchor {
                saveAnchor(anchor, forKey: workoutsAnchorKey)
            }

            // Import activity rings
            let rings = try await healthKit.fetchActivitySummaries(from: startDate)
            if !rings.isEmpty {
                syncStatus = "Importing \(rings.count) activity days..."
                let response = try await api.syncActivityRings(rings)
                if Config.debugLogging {
                    logSync("📊 Activity rings: synced \(response.synced ?? 0)")
                }
            }

            // Update last sync date
            let now = Date()
            lastSyncDate = now
            UserDefaults.standard.set(now, forKey: lastSyncDateKey)

            syncStatus = "Historical import complete! Last synced: \(Self.formatDate(now))"

            if Config.debugLogging {
                logSync("✅ Historical import completed")
            }
        } catch {
            syncError = error.localizedDescription
            syncStatus = "Import failed: \(error.localizedDescription)"

            if Config.debugLogging {
                logSync("❌ Import error: \(error)")
            }
        }

        isSyncing = false
    }

    // MARK: - Private Sync Methods

    /// Returns the number of workouts sent this pass.
    private func syncWorkouts() async throws -> Int {
        let anchor = loadAnchor(forKey: workoutsAnchorKey)
        // Only used when there is no anchor yet; see workoutsAnchorKey.
        let startDate = Calendar.current.date(byAdding: .day, value: -Self.workoutLookbackDays, to: Date()) ?? Date()

        // Metadata only. This runs inside HealthKit observer wakes, where the
        // memory budget is far below foreground; routes follow via backfillRoutes.
        let (workouts, newAnchor) = try await healthKit.fetchWorkouts(from: startDate, anchor: anchor, includeRoutes: false)

        if !workouts.isEmpty {
            let response = try await api.syncWorkouts(workouts)

            if Config.debugLogging {
                logSync("📊 Workouts: synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
            }

            // Queue every one; workouts without GPS drop out on first attempt.
            routeQueue.enqueue(workouts.map { (uuid: $0.healthkitUuid, endDate: $0.endDate) })
            pendingRoutes = routeQueue.count
        }

        // Save new anchor
        if let newAnchor = newAnchor {
            saveAnchor(newAnchor, forKey: workoutsAnchorKey)
        }

        return workouts.count
    }

    /// One anchored fetch + POST per given type, a few at a time, stopping early
    /// if `shouldContinue` says the budget is spent. Each type's anchor persists,
    /// so a type skipped now is only delayed (to the next wake or the nightly).
    ///
    /// A type that fails (HealthKit or network) is logged and skipped so one bad
    /// type can't block the rest; its anchor is left untouched so it retries.
    /// The first error is rethrown at the end so the sync still reports failure
    /// (rings and workouts have already landed by then — see `performFullSync`).
    ///
    /// A type with no anchor yet (newly added to the table) starts from
    /// `lastSyncDate`: forward-only. History for new types is ROADMAP step 4.
    private func syncHealthMetrics(_ entries: [HealthMetricTypes.Entry], maxPages: Int, shouldContinue: @escaping () -> Bool) async throws {
        let startDate = lastSyncDate ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()

        var firstError: Error?
        var attempted = 0

        for start in stride(from: 0, to: entries.count, by: Self.metricConcurrency) {
            guard shouldContinue() else { break }
            let chunk = entries[start..<min(start + Self.metricConcurrency, entries.count)]

            await withTaskGroup(of: (String, Error?).self) { group in
                for entry in chunk {
                    group.addTask { @MainActor in
                        do {
                            try await self.syncMetricType(entry, from: startDate, maxPages: maxPages, shouldContinue: shouldContinue)
                            return (entry.identifier.rawValue, nil)
                        } catch {
                            return (entry.identifier.rawValue, error)
                        }
                    }
                }
                for await (name, error) in group {
                    if let error = error {
                        if Config.debugLogging { logSync("❌ \(name): \(error)") }
                        if firstError == nil { firstError = error }
                    }
                }
            }
            attempted += chunk.count
        }

        if Config.debugLogging && attempted < entries.count {
            logSync("⏱️ Metric pass out of budget at \(attempted)/\(entries.count) types; rest waits for the next wake or nightly")
        }

        if let firstError = firstError {
            throw firstError
        }
    }

    /// Pages through the backlog `metricPageSize` samples at a time, persisting
    /// the anchor after each page lands, so a partial pass (budget spent, crash,
    /// network drop) keeps what it already shipped and resumes where it stopped.
    private func syncMetricType(_ entry: HealthMetricTypes.Entry, from startDate: Date, maxPages: Int, shouldContinue: @escaping () -> Bool) async throws {
        var anchor = loadAnchor(forKey: entry.anchorKey)
            ?? legacyAnchorKeys[entry.identifier].flatMap { loadAnchor(forKey: $0) }

        var page = 0
        repeat {
            page += 1
            let (metrics, newAnchor) = try await healthKit.fetchHealthMetrics(
                entry, from: startDate, anchor: anchor, limit: Self.metricPageSize
            )
            try await postMetrics(metrics, for: entry, page: page)
            if let newAnchor = newAnchor {
                saveAnchor(newAnchor, forKey: entry.anchorKey)
            }
            anchor = newAnchor
            // Short page = caught up. No anchor = can't page safely; stop too.
            guard metrics.count == Self.metricPageSize, newAnchor != nil else { return }
        } while page < maxPages && shouldContinue()

        if Config.debugLogging {
            logSync("⏱️ \(entry.identifier.rawValue): backlog continues after \(page) pages; resumes next run")
        }
    }

    private func postMetrics(_ metrics: [HealthMetricData], for entry: HealthMetricTypes.Entry, page: Int, label: String = "") async throws {
        if !metrics.isEmpty {
            let response = try await api.syncHealthMetrics(metrics)

            if Config.debugLogging {
                logSync("📊 \(label)\(entry.identifier.rawValue)\(page > 1 ? " p\(page)" : ""): synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
            }

            // HTTP 207 = some rows failed; it isn't an error to the client,
            // so check explicitly. Keep the old anchor and let the failed
            // rows be re-fetched (the backend dedupes the rest by UUID).
            if let errors = response.errors, !errors.isEmpty {
                throw NSError(domain: "Sync", code: 207, userInfo: [
                    NSLocalizedDescriptionKey: "\(errors.count) of \(metrics.count) rows rejected: \(errors.first?.error ?? "")"
                ])
            }
        }
        // Returning normally is the "backend has every row of this page" signal;
        // the caller then advances the anchor. A throw above leaves it put.
    }

    private func syncActivityRings() async throws {
        let startDate = lastSyncDate ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()

        let rings = try await healthKit.fetchActivitySummaries(from: startDate)

        if !rings.isEmpty {
            let response = try await api.syncActivityRings(rings)

            if Config.debugLogging {
                logSync("📊 Activity rings: synced \(response.synced ?? 0), updated \(response.updated ?? 0)")
            }
        }
    }

    // MARK: - Anchor Management

    private func saveAnchor(_ anchor: HKQueryAnchor, forKey key: String) {
        do {
            let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
            UserDefaults.standard.set(data, forKey: key)
        } catch {
            if Config.debugLogging {
                logSync("❌ Failed to save anchor: \(error)")
            }
        }
    }

    private func loadAnchor(forKey key: String) -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: key) else {
            return nil
        }

        do {
            guard let anchor = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data) else {
                return nil
            }
            return anchor
        } catch {
            if Config.debugLogging {
                logSync("❌ Failed to load anchor: \(error)")
            }
            return nil
        }
    }

    // MARK: - Helpers

    private static func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
