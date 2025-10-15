//
//  HealthKitService.swift
//  HealthKit Sync
//
//  Handles HealthKit data extraction and permissions
//

import Foundation
import HealthKit
internal import _LocationEssentials

class HealthKitService {
    static let shared = HealthKitService()

    private let healthStore = HKHealthStore()

    // HealthKit data types we want to read
    private let readTypes: Set<HKObjectType> = {
        var types = Set<HKObjectType>()

        // Workouts
        types.insert(HKObjectType.workoutType())

        // Workout routes
        types.insert(HKSeriesType.workoutRoute())

        // Health metrics
        if let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) {
            types.insert(heartRate)
        }
        if let stepCount = HKObjectType.quantityType(forIdentifier: .stepCount) {
            types.insert(stepCount)
        }
        if let bodyMass = HKObjectType.quantityType(forIdentifier: .bodyMass) {
            types.insert(bodyMass)
        }
        if let distanceWalkingRunning = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) {
            types.insert(distanceWalkingRunning)
        }
        if let activeEnergyBurned = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
            types.insert(activeEnergyBurned)
        }

        // Activity summary
        types.insert(HKObjectType.activitySummaryType())

        return types
    }()

    private init() {}

    // MARK: - Authorization

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw NSError(domain: "HealthKit", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "HealthKit is not available on this device"
            ])
        }

        try await healthStore.requestAuthorization(toShare: [], read: readTypes)

        if Config.debugLogging {
            print("✅ HealthKit authorization granted")
        }
    }

    // MARK: - Workouts

    func fetchWorkouts(from startDate: Date, anchor: HKQueryAnchor? = nil) async throws -> (workouts: [WorkoutData], newAnchor: HKQueryAnchor?) {
        return try await withCheckedThrowingContinuation { continuation in
            let workoutType = HKObjectType.workoutType()
            let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)

            let query = HKAnchoredObjectQuery(
                type: workoutType,
                predicate: predicate,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, _, newAnchor, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let workouts = samples as? [HKWorkout] else {
                    continuation.resume(returning: ([], newAnchor))
                    return
                }

                Task {
                    var workoutDataArray: [WorkoutData] = []

                    for workout in workouts {
                        // Fetch route if available
                        let route = try? await self.fetchWorkoutRoute(for: workout)

                        let workoutData = self.convertWorkoutToData(workout, route: route)
                        workoutDataArray.append(workoutData)
                    }

                    continuation.resume(returning: (workoutDataArray, newAnchor))
                }
            }

            healthStore.execute(query)
        }
    }

    private func convertWorkoutToData(_ workout: HKWorkout, route: WorkoutRoute?) -> WorkoutData {
        let iso8601Formatter = ISO8601DateFormatter()
        iso8601Formatter.formatOptions = [.withInternetDateTime]

        return WorkoutData(
            healthkitUuid: workout.uuid.uuidString,
            workoutType: workout.workoutActivityType.name,
            startDate: iso8601Formatter.string(from: workout.startDate),
            endDate: iso8601Formatter.string(from: workout.endDate),
            durationSeconds: Int(workout.duration),
            totalDistanceMeters: workout.totalDistance?.doubleValue(for: .meter()),
            totalEnergyBurnedKcal: workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()),
            avgHeartRateBpm: nil, // Would need separate query for heart rate during workout
            maxHeartRateBpm: nil,
            sourceName: workout.sourceRevision.source.name,
            sourceBundleId: workout.sourceRevision.source.bundleIdentifier,
            deviceName: workout.device?.name,
            metadata: workout.metadata?.mapValues { "\($0)" },
            route: route
        )
    }

    // MARK: - Workout Routes

    private func fetchWorkoutRoute(for workout: HKWorkout) async throws -> WorkoutRoute {
        return try await withCheckedThrowingContinuation { continuation in
            let routeType = HKSeriesType.workoutRoute()
            let predicate = HKQuery.predicateForObjects(from: workout)

            let query = HKSampleQuery(sampleType: routeType, predicate: predicate, limit: 1, sortDescriptors: nil) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let route = samples?.first as? HKWorkoutRoute else {
                    continuation.resume(throwing: NSError(domain: "HealthKit", code: -1, userInfo: [
                        NSLocalizedDescriptionKey: "No route found for workout"
                    ]))
                    return
                }

                Task {
                    do {
                        let points = try await self.fetchRoutePoints(for: route)
                        continuation.resume(returning: WorkoutRoute(points: points))
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            self.healthStore.execute(query)
        }
    }

    private func fetchRoutePoints(for route: HKWorkoutRoute) async throws -> [RoutePoint] {
        return try await withCheckedThrowingContinuation { continuation in
            var routePoints: [RoutePoint] = []
            let iso8601Formatter = ISO8601DateFormatter()
            iso8601Formatter.formatOptions = [.withInternetDateTime]

            let query = HKWorkoutRouteQuery(route: route) { _, locations, done, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                if let locations = locations {
                    for location in locations {
                        let point = RoutePoint(
                            lat: location.coordinate.latitude,
                            lon: location.coordinate.longitude,
                            timestamp: iso8601Formatter.string(from: location.timestamp),
                            altitude: location.altitude,
                            speed: location.speed >= 0 ? location.speed : nil,
                            horizontalAccuracy: location.horizontalAccuracy
                        )
                        routePoints.append(point)
                    }
                }

                if done {
                    continuation.resume(returning: routePoints)
                }
            }

            self.healthStore.execute(query)
        }
    }

    // MARK: - Health Metrics

    func fetchHealthMetrics(type: HKQuantityTypeIdentifier, from startDate: Date, anchor: HKQueryAnchor? = nil) async throws -> (metrics: [HealthMetricData], newAnchor: HKQueryAnchor?) {
        guard let quantityType = HKQuantityType.quantityType(forIdentifier: type) else {
            throw NSError(domain: "HealthKit", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Invalid quantity type"
            ])
        }

        return try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)

            let query = HKAnchoredObjectQuery(
                type: quantityType,
                predicate: predicate,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, _, newAnchor, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let samples = samples as? [HKQuantitySample] else {
                    continuation.resume(returning: ([], newAnchor))
                    return
                }

                let metrics = samples.map { sample in
                    self.convertQuantitySampleToMetric(sample, type: type)
                }

                continuation.resume(returning: (metrics, newAnchor))
            }

            healthStore.execute(query)
        }
    }

    private func convertQuantitySampleToMetric(_ sample: HKQuantitySample, type: HKQuantityTypeIdentifier) -> HealthMetricData {
        let iso8601Formatter = ISO8601DateFormatter()
        iso8601Formatter.formatOptions = [.withInternetDateTime]

        let unit = preferredUnit(for: type)

        return HealthMetricData(
            healthkitUuid: sample.uuid.uuidString,
            metricType: type.rawValue,
            value: sample.quantity.doubleValue(for: unit),
            unit: unit.unitString,
            startDate: iso8601Formatter.string(from: sample.startDate),
            endDate: iso8601Formatter.string(from: sample.endDate),
            sourceName: sample.sourceRevision.source.name,
            sourceBundleId: sample.sourceRevision.source.bundleIdentifier,
            deviceName: sample.device?.name,
            metadata: sample.metadata?.mapValues { "\($0)" }
        )
    }

    private func preferredUnit(for identifier: HKQuantityTypeIdentifier) -> HKUnit {
        switch identifier {
        case .heartRate:
            return HKUnit.count().unitDivided(by: .minute())
        case .stepCount:
            return HKUnit.count()
        case .bodyMass:
            return HKUnit.gramUnit(with: .kilo)
        case .distanceWalkingRunning:
            return HKUnit.meter()
        case .activeEnergyBurned:
            return HKUnit.kilocalorie()
        default:
            return HKUnit.count()
        }
    }

    // MARK: - Activity Rings

    func fetchActivitySummaries(from startDate: Date) async throws -> [ActivityRingData] {
        return try await withCheckedThrowingContinuation { continuation in
            let calendar = Calendar.current
            var startDateComponents = calendar.dateComponents([.year, .month, .day], from: startDate)
            startDateComponents.calendar = calendar
            var endDateComponents = calendar.dateComponents([.year, .month, .day], from: Date())
            endDateComponents.calendar = calendar

            let predicate = HKQuery.predicate(forActivitySummariesBetweenStart: startDateComponents, end: endDateComponents)

            let query = HKActivitySummaryQuery(predicate: predicate) { _, summaries, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let summaries = summaries else {
                    continuation.resume(returning: [])
                    return
                }

                let activityRings = summaries.map { summary in
                    self.convertActivitySummaryToRing(summary)
                }

                continuation.resume(returning: activityRings)
            }

            healthStore.execute(query)
        }
    }

    private func convertActivitySummaryToRing(_ summary: HKActivitySummary) -> ActivityRingData {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"

        let calendar = Calendar.current
        let date = calendar.date(from: summary.dateComponents(for: calendar)) ?? Date()

        let moveGoal = summary.activeEnergyBurnedGoal.doubleValue(for: .kilocalorie())
        let moveActual = summary.activeEnergyBurned.doubleValue(for: .kilocalorie())
        let movePercent = moveGoal > 0 ? (moveActual / moveGoal) * 100 : 0

        let exerciseGoal = summary.appleExerciseTimeGoal.doubleValue(for: .minute())
        let exerciseActual = summary.appleExerciseTime.doubleValue(for: .minute())
        let exercisePercent = exerciseGoal > 0 ? (exerciseActual / exerciseGoal) * 100 : 0

        let standGoal = summary.appleStandHoursGoal.doubleValue(for: .count())
        let standActual = summary.appleStandHours.doubleValue(for: .count())
        let standPercent = standGoal > 0 ? (standActual / standGoal) * 100 : 0

        return ActivityRingData(
            date: dateFormatter.string(from: date),
            moveGoalKcal: Int(moveGoal),
            moveActualKcal: Int(moveActual),
            movePercent: movePercent,
            exerciseGoalMinutes: Int(exerciseGoal),
            exerciseActualMinutes: Int(exerciseActual),
            exercisePercent: exercisePercent,
            standGoalHours: Int(standGoal),
            standActualHours: Int(standActual),
            standPercent: standPercent
        )
    }
}

// MARK: - HKWorkoutActivityType Extension

extension HKWorkoutActivityType {
    var name: String {
        switch self {
        case .running: return "Running"
        case .cycling: return "Cycling"
        case .walking: return "Walking"
        case .swimming: return "Swimming"
        case .hiking: return "Hiking"
        case .yoga: return "Yoga"
        case .functionalStrengthTraining: return "FunctionalStrengthTraining"
        case .traditionalStrengthTraining: return "TraditionalStrengthTraining"
        case .elliptical: return "Elliptical"
        case .rowing: return "Rowing"
        case .stairClimbing: return "StairClimbing"
        case .dance: return "Dance"
        default: return "Other"
        }
    }
}
