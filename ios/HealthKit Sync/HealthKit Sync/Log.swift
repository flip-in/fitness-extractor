import Foundation
import os

/// Unified-log sink. `print()` never reaches the device's unified log, so background wakes were
/// invisible in `log collect` archives; `Logger` lines do, at notice level (persisted to disk).
/// Read with: `log show <archive> --info --predicate 'process == "HealthKit Sync"'`.
/// Everything is marked public: single-user personal app, redaction only hides the diagnostics.
enum Log {
    static let sync = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "HealthKitSync",
        category: "sync"
    )
}

/// Drop-in replacement for `print(_:)` at the former call sites.
func logSync(_ message: String) {
    Log.sync.notice("\(message, privacy: .public)")
}
