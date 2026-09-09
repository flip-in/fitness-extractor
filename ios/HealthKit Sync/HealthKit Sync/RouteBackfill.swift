//
//  RouteBackfill.swift
//  HealthKit Sync
//
//  Workouts are synced in two steps so the app never needs to be opened:
//  1. Metadata only, inside the HealthKit observer wake (30s budget).
//  2. GPS routes later, a few per wake, one workout at a time (a fresh one
//     first). The backend attaches a route to an existing workout.
//  The BGProcessingTask below was meant to sweep the rest overnight; it can't
//  (see `NightlySyncTask`), so wakes are the only path and slowness is accepted.
//

import BackgroundTasks
import Foundation

/// Workouts synced without their GPS route, waiting to have it attached.
/// Persisted in UserDefaults so it survives the process being killed between wakes.
@MainActor
final class RouteBackfillQueue {
    static let shared = RouteBackfillQueue()

    /// Routes fetched per incremental sync. Deliberately small: each route can be
    /// ~2000 CLLocation objects and the wake that runs this has a background budget.
    static let perSyncLimit = 3

    /// Upper bound per BGProcessingTask run. The task's expiration handler is the
    /// real limit; this just stops a runaway loop.
    static let perProcessingTaskLimit = 200

    /// A route this recent is fetched at the head of the next wake, before the
    /// metric tiers eat the budget — a ride should show GPS within the hour, not
    /// after the nightly sweep. Older entries stay on the normal end-of-wake /
    /// nightly path. Decision 2026-09-08 ("option 1").
    static let freshWindow: TimeInterval = 6 * 60 * 60

    private let key = "routeBackfillQueue"
    private let endDatesKey = "routeBackfillEndDates"
    private(set) var uuids: [String]
    /// Workout end time per queued UUID, for `freshest(within:)`. Entries queued
    /// before this existed have none and are simply never "fresh".
    private var endDates: [String: Date]

    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private init() {
        uuids = UserDefaults.standard.stringArray(forKey: key) ?? []
        let raw = UserDefaults.standard.dictionary(forKey: endDatesKey) as? [String: Double] ?? [:]
        endDates = raw.mapValues { Date(timeIntervalSince1970: $0) }
    }

    var count: Int { uuids.count }
    var isEmpty: Bool { uuids.isEmpty }

    /// `endDate` in the backend's ISO 8601 form (`WorkoutData.endDate`).
    func enqueue(_ workouts: [(uuid: String, endDate: String)]) {
        let existing = Set(uuids)
        var changed = false
        for workout in workouts where !existing.contains(workout.uuid) {
            uuids.append(workout.uuid)
            if let date = Self.iso8601.date(from: workout.endDate) {
                endDates[workout.uuid] = date
            }
            changed = true
        }
        if changed { persist() }
    }

    /// Newest first: recent workouts matter more, older GPS can take longer.
    func next(_ limit: Int) -> [String] {
        Array(uuids.suffix(limit).reversed())
    }

    /// The most recently ended queued workout, if it ended within `window`.
    func freshest(within window: TimeInterval) -> String? {
        let cutoff = Date(timeIntervalSinceNow: -window)
        return uuids
            .compactMap { uuid in endDates[uuid].map { (uuid, $0) } }
            .filter { $0.1 > cutoff }
            .max { $0.1 < $1.1 }?
            .0
    }

    func remove(_ uuid: String) {
        uuids.removeAll { $0 == uuid }
        endDates[uuid] = nil
        persist()
    }

    /// Moves a failed entry to the back of the line (`next` serves newest first)
    /// so one route that keeps timing out doesn't head every wake's route step
    /// while the rest of the queue — and the work after it — starves (pi review).
    func demote(_ uuid: String) {
        guard let index = uuids.firstIndex(of: uuid), index != 0 else { return }
        uuids.remove(at: index)
        uuids.insert(uuid, at: 0)
        persist()
    }

    private func persist() {
        UserDefaults.standard.set(uuids, forKey: key)
        UserDefaults.standard.set(endDates.mapValues { $0.timeIntervalSince1970 }, forKey: endDatesKey)
    }
}

/// On-charger full sync via BGTaskScheduler: every metric type, backfill, then
/// the route queue. **Effectively dead, kept as an opportunistic bonus.**
///
/// Measured 2026-09-09 from the phone's unified log: dasd launched this task 17
/// times (every ~30 min, on charger, 00:40–10:57) and every run failed in 50 ms
/// with HealthKit error 6 "Protected health data is inaccessible". The store is
/// unreadable while the phone is locked, and dasd's Device Activity Policy only
/// runs processing tasks while the phone is idle, i.e. locked. The two never
/// overlap on a passcode-locked phone. Observer wakes (only fired while unlocked)
/// are the sole background path with HealthKit access; `SyncService` fits every
/// tier and the history backfill into them.
///
/// Requires, in Info.plist: `UIBackgroundModes` containing `processing`, and
/// `BGTaskSchedulerPermittedIdentifiers` containing `identifier`.
enum NightlySyncTask {
    static let identifier = "com.williamprice.HealthKit-Sync.nightly-sync"

    /// Must be called before `application(_:didFinishLaunchingWithOptions:)` returns.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let task = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(task)
        }
    }

    /// Idempotent: resubmitting replaces the pending request. Safe to call after
    /// every sync. Always scheduled — cheap, and it does run if the phone is ever
    /// idle *and* unlocked on a charger.
    static func schedule() {
        let request = BGProcessingTaskRequest(identifier: identifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)

        do {
            try BGTaskScheduler.shared.submit(request)
            if Config.debugLogging {
                logSync("🗓️ Nightly sync task scheduled (\(RouteBackfillQueue.shared.count) routes pending)")
            }
        } catch {
            // BGTaskSchedulerErrorDomain code 1 = unavailable (simulator, Low Power,
            // or Background App Refresh disabled). Not fatal: observer wakes still run.
            logSync("❌ Failed to schedule nightly sync: \(error)")
        }
    }

    /// Runs on BGTaskScheduler's queue, not the main actor. The expiration handler
    /// must be installed synchronously here, before hopping to the main actor.
    private nonisolated static func handle(_ task: BGProcessingTask) {
        let expired = ExpirationFlag()
        task.expirationHandler = { expired.set() }

        Task { @MainActor in
            let routes = await SyncService.shared.performNightlySync(shouldContinue: { !expired.isSet })
            if Config.debugLogging {
                logSync("🌙 Nightly sync: \(routes) routes, \(RouteBackfillQueue.shared.count) still pending, expired: \(expired.isSet)")
            }
            schedule()
            task.setTaskCompleted(success: !expired.isSet)
        }
    }
}

/// Thread-safe flag for the expiration handler, which fires on an arbitrary queue.
private final class ExpirationFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false

    var isSet: Bool {
        lock.lock(); defer { lock.unlock() }
        return value
    }

    func set() {
        lock.lock(); defer { lock.unlock() }
        value = true
    }
}
