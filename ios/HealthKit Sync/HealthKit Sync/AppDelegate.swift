//
//  AppDelegate.swift
//  HealthKit Sync
//
//  Sets up HealthKit background observers for automatic sync
//

import UIKit
import HealthKit

class AppDelegate: NSObject, UIApplicationDelegate {
    private let healthStore = HKHealthStore()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
        // BGTaskScheduler handlers must be registered before launch finishes.
        RouteBackfillTask.register()
        RouteBackfillTask.scheduleIfNeeded()

        // Set up background delivery observers
        setupBackgroundObservers()

        return true
    }

    private func setupBackgroundObservers() {
        guard HKHealthStore.isHealthDataAvailable() else {
            print("❌ HealthKit not available")
            return
        }

        // Observer for workouts
        setupObserver(for: HKObjectType.workoutType(), dataType: "workouts")

        // Observer for heart rate
        if let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) {
            setupObserver(for: heartRate, dataType: "heartRate")
        }

        // Observer for step count
        if let stepCount = HKObjectType.quantityType(forIdentifier: .stepCount) {
            setupObserver(for: stepCount, dataType: "stepCount")
        }

        // Observer for active energy burned (move ring)
        if let activeEnergy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
            setupObserver(for: activeEnergy, dataType: "activeEnergyBurned")
        }

        // Observer for stand hours (stand ring)
        if let standHour = HKObjectType.categoryType(forIdentifier: .appleStandHour) {
            setupObserver(for: standHour, dataType: "appleStandHour")
        }

        // Note: Activity summaries don't support background observers
        // They are synced during manual/scheduled syncs instead

        if Config.debugLogging {
            print("✅ Background observers set up")
        }
    }

    private func setupObserver(for sampleType: HKSampleType, dataType: String) {
        let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] query, completionHandler, error in
            if let error = error {
                print("❌ Observer error for \(dataType): \(error)")
                completionHandler()
                return
            }

            if Config.debugLogging {
                print("🔔 Background delivery triggered for \(dataType)")
            }

            // Perform sync in background
            Task {
                await self?.handleBackgroundDelivery(for: dataType)
                completionHandler()
            }
        }

        healthStore.execute(query)

        // Enable background delivery
        healthStore.enableBackgroundDelivery(for: sampleType, frequency: .immediate) { success, error in
            if let error = error {
                print("❌ Failed to enable background delivery for \(dataType): \(error)")
            } else if success {
                if Config.debugLogging {
                    print("✅ Background delivery enabled for \(dataType)")
                }
            }
        }
    }

    @MainActor
    private func handleBackgroundDelivery(for dataType: String) async {
        // Trigger a sync when background delivery fires
        await SyncService.shared.performFullSync()
    }
}
