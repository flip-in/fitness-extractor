//
//  HealthMetricTypes.swift
//  HealthKit Sync
//
//  The single table of HealthKit quantity types this app syncs, with the unit
//  each is sent in. Adding a type is one line here: authorization, the anchored
//  fetch, the per-type anchor key and the backend `metric_type` string all
//  derive from it. The backend `health_metrics` table is generic
//  (`metric_type`/`value`/`unit`), so it needs no change.
//
//  Policy (ROADMAP, 2026-09-08): sync everything HealthKit has; decide what's
//  useful downstream. Order matters only for log readability.
//

import HealthKit

enum HealthMetricTypes {
    /// When a type is fetched. A HealthKit observer wake is a 30s window and
    /// each query costs 1–7s in the background, so only a few types fit per
    /// wake. Observer wakes are the *only* background execution that can read
    /// HealthKit: the store is unreadable while the phone is locked, and the
    /// on-charger BGProcessingTask only ever runs while it is locked (measured
    /// 2026-09-09, 17/17 runs failed with HealthKit error 6). So every tier
    /// has to fit into wakes, and "slow" means a few per wake in rotation.
    enum Tier {
        /// Every wake: changes through the day and shows on the dashboard.
        case hot
        /// Only on a wake that just synced a new workout: per-workout series
        /// and post-exercise measurements. Otherwise like `slow`.
        case workout
        /// Daily/slow-changing measurements: `SyncService.slowTypesPerWake` of
        /// them per wake, round-robin, after the hot tier and the route step.
        case slow
    }

    struct Entry {
        let identifier: HKQuantityTypeIdentifier
        let unit: HKUnit
        let tier: Tier

        var quantityType: HKQuantityType { HKQuantityType(identifier) }
        /// UserDefaults key for this type's HKQueryAnchor.
        var anchorKey: String { "anchor.\(identifier.rawValue)" }
    }

    static func entries(in tiers: Set<Tier>) -> [Entry] {
        all.filter { tiers.contains($0.tier) }
    }

    private static let bpm = HKUnit.count().unitDivided(by: .minute())
    private static let ms = HKUnit.secondUnit(with: .milli)
    private static let metersPerSecond = HKUnit.meter().unitDivided(by: .second())
    /// mL/(kg·min)
    private static let vo2MaxUnit = HKUnit.literUnit(with: .milli)
        .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
    /// kcal/(kg·hr), HealthKit's canonical unit for physicalEffort.
    private static let effortUnit = HKUnit.kilocalorie()
        .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .hour()))

    static let all: [Entry] = [
        // Heart
        Entry(identifier: .heartRate, unit: bpm, tier: .hot),
        Entry(identifier: .restingHeartRate, unit: bpm, tier: .slow),
        Entry(identifier: .walkingHeartRateAverage, unit: bpm, tier: .slow),
        Entry(identifier: .heartRateVariabilitySDNN, unit: ms, tier: .slow),
        Entry(identifier: .heartRateRecoveryOneMinute, unit: bpm, tier: .workout),
        Entry(identifier: .vo2Max, unit: vo2MaxUnit, tier: .workout),

        // Vitals
        Entry(identifier: .oxygenSaturation, unit: .percent(), tier: .slow),
        Entry(identifier: .respiratoryRate, unit: bpm, tier: .slow),
        Entry(identifier: .appleSleepingWristTemperature, unit: .degreeCelsius(), tier: .slow),

        // Body
        Entry(identifier: .bodyMass, unit: .gramUnit(with: .kilo), tier: .slow),
        Entry(identifier: .leanBodyMass, unit: .gramUnit(with: .kilo), tier: .slow),
        Entry(identifier: .bodyFatPercentage, unit: .percent(), tier: .slow),
        Entry(identifier: .bodyMassIndex, unit: .count(), tier: .slow),
        Entry(identifier: .height, unit: .meter(), tier: .slow),

        // Activity totals
        Entry(identifier: .stepCount, unit: .count(), tier: .hot),
        Entry(identifier: .flightsClimbed, unit: .count(), tier: .slow),
        Entry(identifier: .distanceWalkingRunning, unit: .meter(), tier: .hot),
        Entry(identifier: .distanceCycling, unit: .meter(), tier: .workout),
        Entry(identifier: .distanceSwimming, unit: .meter(), tier: .workout),
        Entry(identifier: .swimmingStrokeCount, unit: .count(), tier: .workout),
        Entry(identifier: .activeEnergyBurned, unit: .kilocalorie(), tier: .hot),
        Entry(identifier: .basalEnergyBurned, unit: .kilocalorie(), tier: .slow),
        Entry(identifier: .appleExerciseTime, unit: .minute(), tier: .hot),
        Entry(identifier: .appleStandTime, unit: .minute(), tier: .hot),
        Entry(identifier: .timeInDaylight, unit: .minute(), tier: .slow),
        Entry(identifier: .physicalEffort, unit: effortUnit, tier: .workout),

        // Running form
        Entry(identifier: .runningPower, unit: .watt(), tier: .workout),
        Entry(identifier: .runningSpeed, unit: metersPerSecond, tier: .workout),
        Entry(identifier: .runningStrideLength, unit: .meter(), tier: .workout),
        Entry(identifier: .runningVerticalOscillation, unit: .meterUnit(with: .centi), tier: .workout),
        Entry(identifier: .runningGroundContactTime, unit: ms, tier: .workout),

        // Cycling
        Entry(identifier: .cyclingPower, unit: .watt(), tier: .workout),
        Entry(identifier: .cyclingCadence, unit: bpm, tier: .workout),
        Entry(identifier: .cyclingSpeed, unit: metersPerSecond, tier: .workout),
        Entry(identifier: .cyclingFunctionalThresholdPower, unit: .watt(), tier: .workout),

        // Walking / mobility
        Entry(identifier: .walkingSpeed, unit: metersPerSecond, tier: .slow),
        Entry(identifier: .walkingStepLength, unit: .meter(), tier: .slow),
        Entry(identifier: .walkingAsymmetryPercentage, unit: .percent(), tier: .slow),
        Entry(identifier: .walkingDoubleSupportPercentage, unit: .percent(), tier: .slow),
        Entry(identifier: .appleWalkingSteadiness, unit: .percent(), tier: .slow),
        Entry(identifier: .sixMinuteWalkTestDistance, unit: .meter(), tier: .slow),

        // Hearing
        Entry(identifier: .environmentalAudioExposure, unit: .decibelAWeightedSoundPressureLevel(), tier: .slow),
        Entry(identifier: .headphoneAudioExposure, unit: .decibelAWeightedSoundPressureLevel(), tier: .slow),
    ]

    static func entry(for identifier: HKQuantityTypeIdentifier) -> Entry? {
        all.first { $0.identifier == identifier }
    }
}
