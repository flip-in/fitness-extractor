//
//  APIClient.swift
//  HealthKit Sync
//
//  Handles communication with the backend API
//

import Foundation

enum APIError: Error {
    case invalidURL
    case networkError(Error)
    case httpError(statusCode: Int, message: String)
    case decodingError(Error)
    case noData

    var localizedDescription: String {
        switch self {
        case .invalidURL:
            return "Invalid API URL"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .httpError(let statusCode, let message):
            return "HTTP \(statusCode): \(message)"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .noData:
            return "No data received from server"
        }
    }
}

class APIClient {
    static let shared = APIClient()

    private let baseURL: String
    private let apiKey: String
    private let session: URLSession

    private init() {
        self.baseURL = Config.apiBaseURL
        self.apiKey = Config.apiKey

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        self.session = URLSession(configuration: config)
    }

    // MARK: - Generic Request Method

    private func makeRequest<T: Decodable>(
        endpoint: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(endpoint)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")

        if let body = body {
            request.httpBody = body
        }

        if Config.debugLogging {
            print("📡 API Request: \(method) \(endpoint)")
        }

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.noData
            }

            if Config.debugLogging {
                print("📡 API Response: \(httpResponse.statusCode)")
            }

            // Handle HTTP errors
            if httpResponse.statusCode >= 400 {
                let errorMessage = String(data: data, encoding: .utf8) ?? "Unknown error"
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: errorMessage)
            }

            // Decode response
            do {
                let decoder = JSONDecoder()
                let decoded = try decoder.decode(T.self, from: data)
                return decoded
            } catch {
                if Config.debugLogging {
                    print("❌ Decoding error: \(error)")
                    print("Response data: \(String(data: data, encoding: .utf8) ?? "nil")")
                }
                throw APIError.decodingError(error)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }

    // MARK: - Workout Endpoints

    func syncWorkouts(_ workouts: [WorkoutData]) async throws -> SyncResponse {
        let request = WorkoutSyncRequest(userId: Config.userId, workouts: workouts)
        let encoder = JSONEncoder()
        let body = try encoder.encode(request)

        return try await makeRequest(
            endpoint: "/api/sync/workouts",
            method: "POST",
            body: body
        )
    }

    // MARK: - Health Metrics Endpoints

    func syncHealthMetrics(_ metrics: [HealthMetricData]) async throws -> SyncResponse {
        let request = HealthMetricSyncRequest(userId: Config.userId, metrics: metrics)
        let encoder = JSONEncoder()
        let body = try encoder.encode(request)

        return try await makeRequest(
            endpoint: "/api/sync/health-metrics",
            method: "POST",
            body: body
        )
    }

    // MARK: - Activity Rings Endpoints

    func syncActivityRings(_ rings: [ActivityRingData]) async throws -> SyncResponse {
        let request = ActivityRingSyncRequest(userId: Config.userId, activityRings: rings)
        let encoder = JSONEncoder()
        let body = try encoder.encode(request)

        return try await makeRequest(
            endpoint: "/api/sync/activity-rings",
            method: "POST",
            body: body
        )
    }

    // MARK: - Sync Anchor Endpoints

    func getSyncAnchor(dataType: String) async throws -> SyncAnchorResponse {
        return try await makeRequest(
            endpoint: "/api/sync/anchors/\(Config.userId)/\(dataType)",
            method: "GET"
        )
    }

    func updateSyncAnchors(_ anchors: [SyncAnchorData]) async throws -> SyncResponse {
        let request = SyncAnchorRequest(userId: Config.userId, anchors: anchors)
        let encoder = JSONEncoder()
        let body = try encoder.encode(request)

        return try await makeRequest(
            endpoint: "/api/sync/anchors",
            method: "POST",
            body: body
        )
    }

    // MARK: - Health Check

    func healthCheck() async throws -> Bool {
        struct HealthResponse: Codable {
            let status: String
        }

        let response: HealthResponse = try await makeRequest(
            endpoint: "/api/health",
            method: "GET"
        )

        return response.status == "ok"
    }
}
