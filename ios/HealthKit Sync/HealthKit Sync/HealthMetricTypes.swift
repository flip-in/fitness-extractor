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
    /// wake; the rest ride the nightly on-charger task (`NightlySyncTask`).
    enum Tier {
        /// Every wake: changes through the day and shows on the dashboard.
        case hot
        /// Only on a wake that just synced a new workout: per-workout series
        /// and post-exercise measurements. Nightly otherwise.
        case workout
        /// Daily/slow-changing measurements: nightly only.
        case nightly
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
        Entry(identifier: .restingHeartRate, unit: bpm, tier: .nightly),
        Entry(identifier: .walkingHeartRateAverage, unit: bpm, tier: .nightly),
        Entry(identifier: .heartRateVariabilitySDNN, unit: ms, tier: .nightly),
        Entry(identifier: .heartRateRecoveryOneMinute, unit: bpm, tier: .workout),
        Entry(identifier: .vo2Max, unit: vo2MaxUnit, tier: .workout),

        // Vitals
        Entry(identifier: .oxygenSaturation, unit: .percent(), tier: .nightly),
        Entry(identifier: .respiratoryRate, unit: bpm, tier: .nightly),
        Entry(identifier: .appleSleepingWristTemperature, unit: .degreeCelsius(), tier: .nightly),

        // Body
        Entry(identifier: .bodyMass, unit: .gramUnit(with: .kilo), tier: .nightly),
        Entry(identifier: .leanBodyMass, unit: .gramUnit(with: .kilo), tier: .nightly),
        Entry(identifier: .bodyFatPercentage, unit: .percent(), tier: .nightly),
        Entry(identifier: .bodyMassIndex, unit: .count(), tier: .nightly),
        Entry(identifier: .height, unit: .meter(), tier: .nightly),

        // Activity totals
        Entry(identifier: .stepCount, unit: .count(), tier: .hot),
        Entry(identifier: .flightsClimbed, unit: .count(), tier: .nightly),
        Entry(identifier: .distanceWalkingRunning, unit: .meter(), tier: .hot),
        Entry(identifier: .distanceCycling, unit: .meter(), tier: .workout),
        Entry(identifier: .distanceSwimming, unit: .meter(), tier: .workout),
        Entry(identifier: .swimmingStrokeCount, unit: .count(), tier: .workout),
        Entry(identifier: .activeEnergyBurned, unit: .kilocalorie(), tier: .hot),
        Entry(identifier: .basalEnergyBurned, unit: .kilocalorie(), tier: .nightly),
        Entry(identifier: .appleExerciseTime, unit: .minute(), tier: .hot),
        Entry(identifier: .appleStandTime, unit: .minute(), tier: .hot),
        Entry(identifier: .timeInDaylight, unit: .minute(), tier: .nightly),
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
        Entry(identifier: .walkingSpeed, unit: metersPerSecond, tier: .nightly),
        Entry(identifier: .walkingStepLength, unit: .meter(), tier: .nightly),
        Entry(identifier: .walkingAsymmetryPercentage, unit: .percent(), tier: .nightly),
        Entry(identifier: .walkingDoubleSupportPercentage, unit: .percent(), tier: .nightly),
        Entry(identifier: .appleWalkingSteadiness, unit: .percent(), tier: .nightly),
        Entry(identifier: .sixMinuteWalkTestDistance, unit: .meter(), tier: .nightly),

        // Hearing
        Entry(identifier: .environmentalAudioExposure, unit: .decibelAWeightedSoundPressureLevel(), tier: .nightly),
        Entry(identifier: .headphoneAudioExposure, unit: .decibelAWeightedSoundPressureLevel(), tier: .nightly),
    ]

    static func entry(for identifier: HKQuantityTypeIdentifier) -> Entry? {
        all.first { $0.identifier == identifier }
    }
}
