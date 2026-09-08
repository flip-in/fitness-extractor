//
//  SyncService.swift
//  HealthKit Sync
//
//  Orchestrates syncing between HealthKit and backend
//

import Foundation
import HealthKit
import Combine

@MainActor
class SyncService: ObservableObject {
    static let shared = SyncService()

    @Published var isSyncing = false
    @Published var lastSyncDate: Date?
    @Published var syncStatus = "Not synced"
    @Published var syncError: String?
    @Published var pendingRoutes = RouteBackfillQueue.shared.count

    private let healthKit = HealthKitService.shared
    private let api = APIClient.shared
    private let routeQueue = RouteBackfillQueue.shared

    // UserDefaults keys for storing anchors
    private let workoutsAnchorKey = "workoutsAnchor"
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
    func performFullSync(budget: TimeInterval? = SyncService.wakeBudget, allMetrics: Bool = false, shouldContinue: @escaping () -> Bool = { true }) async {
        guard !isSyncing else {
            if Config.debugLogging {
                logSync("⏭️ Sync already in progress, skipping")
            }
            return
        }

        isSyncing = true
        syncError = nil
        syncStatus = "Syncing..."

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

            // Health metrics: hot tier every wake; workout tier when a workout
            // just landed (its HR recovery, running/cycling series are new);
            // everything when asked (nightly task, foreground button).
            var tiers: Set<HealthMetricTypes.Tier> = [.hot]
            if newWorkouts > 0 { tiers.insert(.workout) }
            if allMetrics { tiers = [.hot, .workout, .nightly] }
            try await syncHealthMetrics(HealthMetricTypes.entries(in: tiers), shouldContinue: withinBudget)

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

        // Routes last, after the cheap work has landed: a few per wake keeps each
        // wake inside its budget, and the nightly task sweeps whatever is left.
        // Only if time remains — a route is thousands of CLLocations and a
        // suspended process mid-fetch just wastes the wake.
        if withinBudget() {
            _ = await backfillRoutes(limit: RouteBackfillQueue.perSyncLimit, shouldContinue: withinBudget)
        }
        NightlySyncTask.schedule()

        isSyncing = false
    }

    /// The nightly BGProcessingTask body: unbounded full sync (all 43 metric
    /// types, minutes of runtime on charger) then as many routes as fit.
    /// Returns the number of routes sent, for the task's success flag.
    func performNightlySync(shouldContinue: @escaping () -> Bool) async -> Int {
        await performFullSync(budget: nil, allMetrics: true, shouldContinue: shouldContinue)
        guard shouldContinue() else { return 0 }
        return await backfillRoutes(limit: RouteBackfillQueue.perProcessingTaskLimit, shouldContinue: shouldContinue)
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
        let startDate = lastSyncDate ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()

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
    private func syncHealthMetrics(_ entries: [HealthMetricTypes.Entry], shouldContinue: () -> Bool) async throws {
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
                            try await self.syncMetricType(entry, from: startDate)
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

    private func syncMetricType(_ entry: HealthMetricTypes.Entry, from startDate: Date) async throws {
        let anchor = loadAnchor(forKey: entry.anchorKey)
            ?? legacyAnchorKeys[entry.identifier].flatMap { loadAnchor(forKey: $0) }

        let (metrics, newAnchor) = try await healthKit.fetchHealthMetrics(entry, from: startDate, anchor: anchor)

        if !metrics.isEmpty {
            let response = try await api.syncHealthMetrics(metrics)

            if Config.debugLogging {
                logSync("📊 \(entry.identifier.rawValue): synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
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

        // Only after the backend has every row: a failure above leaves
        // the old anchor so the samples are re-fetched next time.
        if let newAnchor = newAnchor {
            saveAnchor(newAnchor, forKey: entry.anchorKey)
        }
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
