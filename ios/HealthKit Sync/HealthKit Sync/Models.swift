//
//  Models.swift
//  HealthKit Sync
//
//  Data models matching the backend API specification
//

import Foundation

// MARK: - Workout Models

struct WorkoutData: Codable {
    let healthkitUuid: String
    let workoutType: String
    let startDate: String
    let endDate: String
    let durationSeconds: Int
    let totalDistanceMeters: Double?
    let totalEnergyBurnedKcal: Double?
    let avgHeartRateBpm: Int?
    let maxHeartRateBpm: Int?
    let sourceName: String?
    let sourceBundleId: String?
    let deviceName: String?
    let metadata: [String: String]?
    let route: WorkoutRoute?

    enum CodingKeys: String, CodingKey {
        case healthkitUuid = "healthkit_uuid"
        case workoutType = "workout_type"
        case startDate = "start_date"
        case endDate = "end_date"
        case durationSeconds = "duration_seconds"
        case totalDistanceMeters = "total_distance_meters"
        case totalEnergyBurnedKcal = "total_energy_burned_kcal"
        case avgHeartRateBpm = "avg_heart_rate_bpm"
        case maxHeartRateBpm = "max_heart_rate_bpm"
        case sourceName = "source_name"
        case sourceBundleId = "source_bundle_id"
        case deviceName = "device_name"
        case metadata
        case route
    }
}

struct WorkoutRoute: Codable {
    let points: [RoutePoint]
}

struct RoutePoint: Codable {
    let lat: Double
    let lon: Double
    let timestamp: String
    let altitude: Double?
    let speed: Double?
    let horizontalAccuracy: Double?

    enum CodingKeys: String, CodingKey {
        case lat, lon, timestamp, altitude, speed
        case horizontalAccuracy = "horizontal_accuracy"
    }
}

struct WorkoutSyncRequest: Codable {
    let userId: String
    let workouts: [WorkoutData]

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case workouts
    }
}

// MARK: - Health Metric Models

struct HealthMetricData: Codable {
    let healthkitUuid: String
    let metricType: String
    let value: Double
    let unit: String
    let startDate: String
    let endDate: String
    let sourceName: String?
    let sourceBundleId: String?
    let deviceName: String?
    let metadata: [String: String]?

    enum CodingKeys: String, CodingKey {
        case healthkitUuid = "healthkit_uuid"
        case metricType = "metric_type"
        case value, unit
        case startDate = "start_date"
        case endDate = "end_date"
        case sourceName = "source_name"
        case sourceBundleId = "source_bundle_id"
        case deviceName = "device_name"
        case metadata
    }
}

struct HealthMetricSyncRequest: Codable {
    let userId: String
    let metrics: [HealthMetricData]

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case metrics
    }
}

// MARK: - Activity Ring Models

struct ActivityRingData: Codable {
    let date: String
    let moveGoalKcal: Int
    let moveActualKcal: Int
    let movePercent: Double
    let exerciseGoalMinutes: Int
    let exerciseActualMinutes: Int
    let exercisePercent: Double
    let standGoalHours: Int
    let standActualHours: Int
    let standPercent: Double

    enum CodingKeys: String, CodingKey {
        case date
        case moveGoalKcal = "move_goal_kcal"
        case moveActualKcal = "move_actual_kcal"
        case movePercent = "move_percent"
        case exerciseGoalMinutes = "exercise_goal_minutes"
        case exerciseActualMinutes = "exercise_actual_minutes"
        case exercisePercent = "exercise_percent"
        case standGoalHours = "stand_goal_hours"
        case standActualHours = "stand_actual_hours"
        case standPercent = "stand_percent"
    }
}

struct ActivityRingSyncRequest: Codable {
    let userId: String
    let activityRings: [ActivityRingData]

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case activityRings = "activity_rings"
    }
}

// MARK: - Sync Anchor Models

struct SyncAnchorData: Codable {
    let dataType: String
    let anchorData: String

    enum CodingKeys: String, CodingKey {
        case dataType = "data_type"
        case anchorData = "anchor_data"
    }
}

struct SyncAnchorRequest: Codable {
    let userId: String
    let anchors: [SyncAnchorData]

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case anchors
    }
}

struct SyncAnchorResponse: Codable {
    let success: Bool
    let anchor: SyncAnchorResponseData?
}

struct SyncAnchorResponseData: Codable {
    let anchorData: String
    let lastSyncAt: String

    enum CodingKeys: String, CodingKey {
        case anchorData = "anchor_data"
        case lastSyncAt = "last_sync_at"
    }
}

// MARK: - API Response Models

struct SyncResponse: Codable {
    let success: Bool
    let synced: Int?
    let skipped: Int?
    let updated: Int?
    let errors: [SyncError]?
}

struct SyncError: Codable {
    let healthkitUuid: String?
    let date: String?
    let dataType: String?
    let error: String

    enum CodingKeys: String, CodingKey {
        case healthkitUuid = "healthkit_uuid"
        case date
        case dataType = "data_type"
        case error
    }
}
