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
    private let heartRateAnchorKey = "heartRateAnchor"
    private let stepCountAnchorKey = "stepCountAnchor"
    private let lastSyncDateKey = "lastSyncDate"

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

            // Sync health metrics
            try await syncHealthMetrics()

            // Sync activity rings
            try await syncActivityRings()

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

    private func syncHealthMetrics() async throws {
        // Sync heart rate
        let heartRateAnchor = loadAnchor(forKey: heartRateAnchorKey)
        let startDate = lastSyncDate ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()

        let (heartRateMetrics, newHeartRateAnchor) = try await healthKit.fetchHealthMetrics(
            type: .heartRate,
            from: startDate,
            anchor: heartRateAnchor
        )

        if !heartRateMetrics.isEmpty {
            let response = try await api.syncHealthMetrics(heartRateMetrics)

            if Config.debugLogging {
                print("📊 Heart rate: synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
            }
        }

        if let newHeartRateAnchor = newHeartRateAnchor {
            saveAnchor(newHeartRateAnchor, forKey: heartRateAnchorKey)
        }

        // Sync step count
        let stepCountAnchor = loadAnchor(forKey: stepCountAnchorKey)

        let (stepCountMetrics, newStepCountAnchor) = try await healthKit.fetchHealthMetrics(
            type: .stepCount,
            from: startDate,
            anchor: stepCountAnchor
        )

        if !stepCountMetrics.isEmpty {
            let response = try await api.syncHealthMetrics(stepCountMetrics)

            if Config.debugLogging {
                print("📊 Step count: synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
            }
        }

        if let newStepCountAnchor = newStepCountAnchor {
            saveAnchor(newStepCountAnchor, forKey: stepCountAnchorKey)
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
