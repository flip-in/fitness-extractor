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

    private let healthKit = HealthKitService.shared
    private let api = APIClient.shared

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

            // Sync workouts
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

        isSyncing = false
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

        let (workouts, newAnchor) = try await healthKit.fetchWorkouts(from: startDate, anchor: anchor)

        if !workouts.isEmpty {
            let response = try await api.syncWorkouts(workouts)

            if Config.debugLogging {
                print("📊 Workouts: synced \(response.synced ?? 0), skipped \(response.skipped ?? 0)")
            }
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
