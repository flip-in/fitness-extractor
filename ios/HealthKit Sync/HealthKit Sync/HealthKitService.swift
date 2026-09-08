//
//  HealthKitService.swift
//  HealthKit Sync
//
//  Handles HealthKit data extraction and permissions
//

import Foundation
import HealthKit
internal import _LocationEssentials

enum HealthKitError: Error {
    /// The workout has no HKWorkoutRoute sample (indoor, strength, etc.).
    case noRoute
    /// The workout was deleted from HealthKit since we queued it.
    case workoutNotFound
}

class HealthKitService {
    static let shared = HealthKitService()

    private let healthStore = HKHealthStore()

    /// One formatter for every sample/point conversion. ISO8601DateFormatter is
    /// thread-safe once configured; constructing one per sample (~217k metrics,
    /// ~1.7M route points in a full import) was measurable CPU and allocation churn.
    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

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

        // Stand hours. Required for the appleStandHour background observer in
        // AppDelegate — an observer on a type absent from this set fails with
        // "Authorization not determined", since the app never asked for it.
        if let standHour = HKObjectType.categoryType(forIdentifier: .appleStandHour) {
            types.insert(standHour)
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

    /// Fetches workouts newer than `anchor` (or all since `startDate` when nil).
    ///
    /// `includeRoutes: false` returns metadata only. Routes are the expensive part
    /// (thousands of CLLocation objects per workout) and the background wake that
    /// runs the incremental sync has a memory budget roughly an order of magnitude
    /// below foreground — see `SyncService.backfillRoutes` for how routes catch up.
    func fetchWorkouts(from startDate: Date, anchor: HKQueryAnchor? = nil, includeRoutes: Bool = true) async throws -> (workouts: [WorkoutData], newAnchor: HKQueryAnchor?) {
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
                        let workoutData = await self.buildWorkoutData(workout, includeRoute: includeRoutes)
                        workoutDataArray.append(workoutData)
                    }

                    continuation.resume(returning: (workoutDataArray, newAnchor))
                }
            }

            healthStore.execute(query)
        }
    }

    /// Fetches one workout by UUID, with its route. Used by the route backfill
    /// queue, which drains workouts one at a time inside background budgets.
    ///
    /// Throws `HealthKitError.workoutNotFound` if it's gone from HealthKit and
    /// `HealthKitError.noRoute` if it never had GPS — both mean "drop from queue".
    func fetchWorkoutWithRoute(uuid: UUID) async throws -> WorkoutData {
        let workout: HKWorkout = try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForObject(with: uuid)
            let query = HKSampleQuery(sampleType: .workoutType(), predicate: predicate, limit: 1, sortDescriptors: nil) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let workout = samples?.first as? HKWorkout {
                    continuation.resume(returning: workout)
                } else {
                    continuation.resume(throwing: HealthKitError.workoutNotFound)
                }
            }
            healthStore.execute(query)
        }

        // Not `try?` here: the caller needs noRoute to prune the queue.
        let route = try await fetchWorkoutRoute(for: workout)
        let heartRateStats = try? await fetchHeartRateStats(for: workout)
        return autoreleasepool {
            convertWorkoutToData(workout, route: route, heartRateStats: heartRateStats)
        }
    }

    private func buildWorkoutData(_ workout: HKWorkout, includeRoute: Bool) async -> WorkoutData {
        let route = includeRoute ? try? await fetchWorkoutRoute(for: workout) : nil
        let heartRateStats = try? await fetchHeartRateStats(for: workout)

        // Drain per-workout autoreleased temporaries (metadata bridging, HK
        // object accessors) instead of letting them pile up across a long import.
        return autoreleasepool {
            convertWorkoutToData(workout, route: route, heartRateStats: heartRateStats)
        }
    }

    private func convertWorkoutToData(_ workout: HKWorkout, route: WorkoutRoute?, heartRateStats: (avg: Double?, max: Double?)? = nil) -> WorkoutData {
        return WorkoutData(
            healthkitUuid: workout.uuid.uuidString,
            workoutType: workout.workoutActivityType.name,
            startDate: Self.iso8601.string(from: workout.startDate),
            endDate: Self.iso8601.string(from: workout.endDate),
            durationSeconds: Int(workout.duration),
            totalDistanceMeters: workout.totalDistance?.doubleValue(for: .meter()),
            totalEnergyBurnedKcal: workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()),
            avgHeartRateBpm: heartRateStats?.avg.map { Int($0) },
            maxHeartRateBpm: heartRateStats?.max.map { Int($0) },
            sourceName: workout.sourceRevision.source.name,
            sourceBundleId: workout.sourceRevision.source.bundleIdentifier,
            deviceName: workout.device?.name,
            metadata: workout.metadata?.mapValues { "\($0)" },
            route: route
        )
    }

    // MARK: - Heart Rate Statistics for Workout

    private func fetchHeartRateStats(for workout: HKWorkout) async throws -> (avg: Double?, max: Double?) {
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            return (nil, nil)
        }

        let predicate = HKQuery.predicateForSamples(
            withStart: workout.startDate,
            end: workout.endDate,
            options: .strictStartDate
        )

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: heartRateType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let samples = samples as? [HKQuantitySample], !samples.isEmpty else {
                    continuation.resume(returning: (nil, nil))
                    return
                }

                let unit = HKUnit.count().unitDivided(by: .minute())
                let heartRates = samples.map { $0.quantity.doubleValue(for: unit) }

                let avg = heartRates.reduce(0, +) / Double(heartRates.count)
                let max = heartRates.max()

                continuation.resume(returning: (avg, max))
            }

            self.healthStore.execute(query)
        }
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
                    continuation.resume(throwing: HealthKitError.noRoute)
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

            let query = HKWorkoutRouteQuery(route: route) { _, locations, done, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                // HealthKit delivers the route in chunks of CLLocation (ObjC
                // objects). Drain each chunk's autoreleased temporaries here rather
                // than trusting the callback queue to do it before the next chunk.
                if let locations = locations {
                    autoreleasepool {
                        for location in locations {
                            let point = RoutePoint(
                                lat: location.coordinate.latitude,
                                lon: location.coordinate.longitude,
                                timestamp: Self.iso8601.string(from: location.timestamp),
                                altitude: location.altitude,
                                speed: location.speed >= 0 ? location.speed : nil,
                                horizontalAccuracy: location.horizontalAccuracy
                            )
                            routePoints.append(point)
                        }
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
        let unit = preferredUnit(for: type)

        return HealthMetricData(
            healthkitUuid: sample.uuid.uuidString,
            metricType: type.rawValue,
            value: sample.quantity.doubleValue(for: unit),
            unit: unit.unitString,
            startDate: Self.iso8601.string(from: sample.startDate),
            endDate: Self.iso8601.string(from: sample.endDate),
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
        case .surfingSports: return "Surfing"
        case .skatingSports: return "Skateboarding"
        case .climbing: return "Climbing"
        default: return "Other"
        }
    }
}
