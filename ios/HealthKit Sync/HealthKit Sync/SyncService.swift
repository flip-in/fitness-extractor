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

    func performFullSync() async {
        guard !isSyncing else {
            if Config.debugLogging {
                print("⏭️ Sync already in progress, skipping")
            }
            return
        }

        isSyncing = true
        syncError = nil
        syncStatus = "Syncing..."

        do {
            // Test backend connection first
            let isHealthy = try await api.healthCheck()
            if !isHealthy {
                throw NSError(domain: "Backend", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: "Backend health check failed"
                ])
            }

            // Sync workouts (metadata only; routes queue up for backfill)
            try await syncWorkouts()

            // Rings before metrics: they are the most visible thing on the
            // dashboard and one cheap query. Metrics are 43 queries and any
            // one of them can fail (e.g. a type not yet authorized) — that
            // must not cost the rings update.
            try await syncActivityRings()

            // Sync health metrics
            try await syncHealthMetrics()

            // Update last sync date
            let now = Date()
            lastSyncDate = now
            UserDefaults.standard.set(now, forKey: lastSyncDateKey)

            syncStatus = "Last synced: \(Self.formatDate(now))"

            if Config.debugLogging {
                print("✅ Full sync completed successfully")
            }
        } catch {
            syncError = error.localizedDescription
            syncStatus = "Sync failed: \(error.localizedDescription)"

            if Config.debugLogging {
                print("❌ Sync error: \(error)")
            }
        }

        // Routes last, after the cheap work has landed: a few per wake keeps each
        // wake inside its budget, and the nightly task sweeps whatever is left.
        _ = await backfillRoutes(limit: RouteBackfillQueue.perSyncLimit)
        RouteBackfillTask.scheduleIfNeeded()

        isSyncing = false
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

            guard let uuid = UUID(uuidString: uuidString) else {
                routeQueue.remove(uuidString)
                continue
            }

            do {
                let workout = try await healthKit.fetchWorkoutWithRoute(uuid: uuid)
                let response = try await api.syncWorkouts([workout])
                routeQueue.remove(uuidString)
                sent += 1

                if Config.debugLogging {
                    print("🗺️ Route attached for \(uuidString): updated \(response.updated ?? 0), skipped \(response.skipped ?? 0)")
                }
            } catch let error as HealthKitError {
                // noRoute / workoutNotFound: nothing to send, ever.
                routeQueue.remove(uuidString)
                if Config.debugLogging {
                    print("🗺️ Dropped \(uuidString) from route queue: \(error)")
                }
            } catch {
                if Config.debugLogging {
                    print("❌ Route backfill stopped: \(error)")
                }
                break
            }
        }

        pendingRoutes = routeQueue.count
        return sent
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
                    print("📊 Historical workouts: synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
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
                    print("📊 Activity rings: synced \(response.synced ?? 0)")
                }
            }

            // Update last sync date
            let now = Date()
            lastSyncDate = now
            UserDefaults.standard.set(now, forKey: lastSyncDateKey)

            syncStatus = "Historical import complete! Last synced: \(Self.formatDate(now))"

            if Config.debugLogging {
                print("✅ Historical import completed")
            }
        } catch {
            syncError = error.localizedDescription
            syncStatus = "Import failed: \(error.localizedDescription)"

            if Config.debugLogging {
                print("❌ Import error: \(error)")
            }
        }

        isSyncing = false
    }

    // MARK: - Private Sync Methods

    private func syncWorkouts() async throws {
        let anchor = loadAnchor(forKey: workoutsAnchorKey)
        let startDate = lastSyncDate ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()

        // Metadata only. This runs inside HealthKit observer wakes, where the
        // memory budget is far below foreground; routes follow via backfillRoutes.
        let (workouts, newAnchor) = try await healthKit.fetchWorkouts(from: startDate, anchor: anchor, includeRoutes: false)

        if !workouts.isEmpty {
            let response = try await api.syncWorkouts(workouts)

            if Config.debugLogging {
                print("📊 Workouts: synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
            }

            // Queue every one; workouts without GPS drop out on first attempt.
            routeQueue.enqueue(workouts.map { $0.healthkitUuid })
            pendingRoutes = routeQueue.count
        }

        // Save new anchor
        if let newAnchor = newAnchor {
            saveAnchor(newAnchor, forKey: workoutsAnchorKey)
        }
    }

    /// One anchored fetch + POST per type in `HealthMetricTypes.all`. A type that
    /// fails (HealthKit or network) is logged and skipped so one bad type can't
    /// block the other ~40; its anchor is left untouched so it retries next wake.
    /// The first error is rethrown at the end so the sync still reports failure
    /// (rings and workouts have already landed by then — see `performFullSync`).
    ///
    /// A type with no anchor yet (newly added to the table) starts from
    /// `lastSyncDate`: forward-only. History for new types is ROADMAP step 4.
    private func syncHealthMetrics() async throws {
        let startDate = lastSyncDate ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        var firstError: Error?

        for entry in HealthMetricTypes.all {
            let anchor = loadAnchor(forKey: entry.anchorKey)
                ?? legacyAnchorKeys[entry.identifier].flatMap { loadAnchor(forKey: $0) }

            do {
                let (metrics, newAnchor) = try await healthKit.fetchHealthMetrics(entry, from: startDate, anchor: anchor)

                if !metrics.isEmpty {
                    let response = try await api.syncHealthMetrics(metrics)

                    if Config.debugLogging {
                        print("📊 \(entry.identifier.rawValue): synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
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
            } catch {
                if Config.debugLogging {
                    print("❌ \(entry.identifier.rawValue): \(error)")
                }
                if firstError == nil { firstError = error }
            }
        }

        if let firstError = firstError {
            throw firstError
        }
    }

    private func syncActivityRings() async throws {
        let startDate = lastSyncDate ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()

        let rings = try await healthKit.fetchActivitySummaries(from: startDate)

        if !rings.isEmpty {
            let response = try await api.syncActivityRings(rings)

            if Config.debugLogging {
                print("📊 Activity rings: synced \(response.synced ?? 0), updated \(response.updated ?? 0)")
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
                print("❌ Failed to save anchor: \(error)")
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
                print("❌ Failed to load anchor: \(error)")
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
