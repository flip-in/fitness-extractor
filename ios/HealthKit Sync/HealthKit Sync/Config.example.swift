//
//  Config.example.swift
//  HealthKit Sync
//
//  Configuration template - Copy this to Config.swift and fill in your values
//

import Foundation

struct Config {
    // MARK: - API Configuration

    /// Backend API base URL
    /// For development: Use your Mac's local IP address (e.g., "http://192.168.1.100:3000")
    /// For production: Use your NAS IP via Tailscale (e.g., "http://100.x.x.x:3000")
    static let apiBaseURL = "http://YOUR_BACKEND_IP:3000" // TODO: Replace with your backend URL

    /// API Key for authentication
    /// Get this from your backend .env file (API_KEY value)
    static let apiKey = "YOUR_API_KEY_HERE" // TODO: Replace with your API key

    /// User ID (MVP uses single user)
    static let userId = "00000000-0000-0000-0000-000000000001"

    // MARK: - Sync Configuration

    /// Number of days of historical data to import on first sync.
    /// Raise temporarily to backfill further, then set back.
    static let historicalImportDays = 90

    /// Max encoded size of a single sync request body. Sync payloads are split
    /// into batches under this size — a large import embeds full GPS routes and
    /// will otherwise exceed the backend's 50MB body limit in one request.
    static let maxSyncBatchBytes = 8 * 1024 * 1024

    /// Whether to enable debug logging
    static let debugLogging = true
}
