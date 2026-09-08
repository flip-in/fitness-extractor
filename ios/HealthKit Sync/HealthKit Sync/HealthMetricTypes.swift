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
    struct Entry {
        let identifier: HKQuantityTypeIdentifier
        let unit: HKUnit

        var quantityType: HKQuantityType { HKQuantityType(identifier) }
        /// UserDefaults key for this type's HKQueryAnchor.
        var anchorKey: String { "anchor.\(identifier.rawValue)" }
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
        Entry(identifier: .heartRate, unit: bpm),
        Entry(identifier: .restingHeartRate, unit: bpm),
        Entry(identifier: .walkingHeartRateAverage, unit: bpm),
        Entry(identifier: .heartRateVariabilitySDNN, unit: ms),
        Entry(identifier: .heartRateRecoveryOneMinute, unit: bpm),
        Entry(identifier: .vo2Max, unit: vo2MaxUnit),

        // Vitals
        Entry(identifier: .oxygenSaturation, unit: .percent()),
        Entry(identifier: .respiratoryRate, unit: bpm),
        Entry(identifier: .appleSleepingWristTemperature, unit: .degreeCelsius()),

        // Body
        Entry(identifier: .bodyMass, unit: .gramUnit(with: .kilo)),
        Entry(identifier: .leanBodyMass, unit: .gramUnit(with: .kilo)),
        Entry(identifier: .bodyFatPercentage, unit: .percent()),
        Entry(identifier: .bodyMassIndex, unit: .count()),
        Entry(identifier: .height, unit: .meter()),

        // Activity totals
        Entry(identifier: .stepCount, unit: .count()),
        Entry(identifier: .flightsClimbed, unit: .count()),
        Entry(identifier: .distanceWalkingRunning, unit: .meter()),
        Entry(identifier: .distanceCycling, unit: .meter()),
        Entry(identifier: .distanceSwimming, unit: .meter()),
        Entry(identifier: .swimmingStrokeCount, unit: .count()),
        Entry(identifier: .activeEnergyBurned, unit: .kilocalorie()),
        Entry(identifier: .basalEnergyBurned, unit: .kilocalorie()),
        Entry(identifier: .appleExerciseTime, unit: .minute()),
        Entry(identifier: .appleStandTime, unit: .minute()),
        Entry(identifier: .timeInDaylight, unit: .minute()),
        Entry(identifier: .physicalEffort, unit: effortUnit),

        // Running form
        Entry(identifier: .runningPower, unit: .watt()),
        Entry(identifier: .runningSpeed, unit: metersPerSecond),
        Entry(identifier: .runningStrideLength, unit: .meter()),
        Entry(identifier: .runningVerticalOscillation, unit: .meterUnit(with: .centi)),
        Entry(identifier: .runningGroundContactTime, unit: ms),

        // Cycling
        Entry(identifier: .cyclingPower, unit: .watt()),
        Entry(identifier: .cyclingCadence, unit: bpm),
        Entry(identifier: .cyclingSpeed, unit: metersPerSecond),
        Entry(identifier: .cyclingFunctionalThresholdPower, unit: .watt()),

        // Walking / mobility
        Entry(identifier: .walkingSpeed, unit: metersPerSecond),
        Entry(identifier: .walkingStepLength, unit: .meter()),
        Entry(identifier: .walkingAsymmetryPercentage, unit: .percent()),
        Entry(identifier: .walkingDoubleSupportPercentage, unit: .percent()),
        Entry(identifier: .appleWalkingSteadiness, unit: .percent()),
        Entry(identifier: .sixMinuteWalkTestDistance, unit: .meter()),

        // Hearing
        Entry(identifier: .environmentalAudioExposure, unit: .decibelAWeightedSoundPressureLevel()),
        Entry(identifier: .headphoneAudioExposure, unit: .decibelAWeightedSoundPressureLevel()),
    ]

    static func entry(for identifier: HKQuantityTypeIdentifier) -> Entry? {
        all.first { $0.identifier == identifier }
    }
}
