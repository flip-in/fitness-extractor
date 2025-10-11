# iOS Background Sync Strategies for HealthKit Fitness Data

**Research Date:** October 11, 2025
**iOS Versions Covered:** iOS 17, iOS 18
**Objective:** Determine the best strategy for automatic background sync of HealthKit data without requiring user to open the app

---

## Executive Summary

**RECOMMENDED SOLUTION: HealthKit Background Delivery with HKObserverQuery**

For a HealthKit fitness data extraction app that needs automatic background sync, the native HealthKit Background Delivery mechanism using `HKObserverQuery` combined with `HKAnchoredObjectQuery` is the most appropriate solution. While it has limitations in terms of guaranteed frequency, it is the only Apple-sanctioned method that reliably wakes your app when new health data is written to HealthKit, making it ideal for syncing workout completions and health metrics.

**Key Advantages:**
- Native HealthKit integration designed specifically for this use case
- Can wake app from terminated state when new health data is added
- Works without user intervention once set up
- More reliable than generic BGAppRefreshTask for health data
- Battery-efficient (iOS manages execution based on system conditions)

**Key Limitations:**
- NOT truly hourly - iOS controls actual execution frequency
- Requires device to be unlocked (privacy/encryption requirement)
- Frequency can vary from hourly to daily based on system conditions
- Not real-time (delivers "some time shortly after" data is written)

---

## Background Execution Options Available in iOS

### 1. HealthKit Background Delivery + HKObserverQuery

#### How It Works
- Register interest in specific HealthKit data types (workouts, steps, heart rate, etc.)
- iOS wakes your app in the background when new data of that type is written to HealthKit
- Your app has a few seconds to query the new data and sync to your backend
- Must be set up in `application(_:didFinishLaunchingWithOptions:)` to ensure queries are ready before HealthKit delivers updates

#### Frequency & Reliability
- **Frequency Options:** `.immediate`, `.hourly`, `.daily`, `.weekly`
- **Reality Check:** Even with `.immediate`, most data types update at most once per hour
- **Workouts:** Have `.immediate` frequency, meaning updates occur "some time shortly after" workout completion
- **Step Count:** Enforced maximum of hourly updates by iOS
- **Actual Timing:** iOS has full discretion to defer based on:
  - CPU usage
  - Battery level and charging state
  - Connectivity status
  - Low Power Mode
  - When device exits Sleep Mode
  - System load
- **Confirmed Status:** Working on iOS 17 (2024), still current in iOS 18

#### Battery Impact
- **Low to Medium** - iOS actively manages execution to preserve battery
- More efficient than polling or BGAppRefreshTask
- System defers updates during low battery or Low Power Mode
- Designed by Apple to be battery-conscious

#### Setup Complexity
- **Medium**
- Requires proper entitlements and capabilities
- Must understand observer pattern and anchored queries
- Need to handle completion callbacks correctly

#### Limitations & Caveats
1. **Device Lock Restriction:** If device is locked with passcode, NO background delivery observers are called (privacy/encryption). Observers fire immediately upon unlock if minimum frequency time has passed.

2. **No Guarantees:** The update handler is "advisory" - invocations don't necessarily correspond 1:1 with HealthKit changes

3. **Not Real-Time:** Even "immediate" means "some time shortly after" the data is written

4. **Three-Strike Rule:** If you don't call the completion handler, iOS tries 3 times with backoff, then stops sending updates

5. **Observer Doesn't Return Data:** HKObserverQuery only notifies that data changed - you must run another query (HKAnchoredObjectQuery) to get actual data

6. **Setup Location Critical:** Must set up in app delegate's `didFinishLaunchingWithOptions` method

7. **Type-Specific Limits:** Some data types have minimum update frequencies (e.g., hourly) regardless of your requested frequency

#### Code Requirements

**Info.plist Capabilities:**
```xml
<key>UIBackgroundModes</key>
<array>
    <string>processing</string>
</array>
```

**Entitlements:**
- `com.apple.developer.healthkit` (HealthKit capability)
- `com.apple.developer.healthkit.background-delivery` (Background Delivery entitlement)

**Implementation Pattern:**
```swift
// In AppDelegate.swift - didFinishLaunchingWithOptions
class AppDelegate: UIResponder, UIApplicationDelegate {
    let healthStore = HKHealthStore()
    var workoutsAnchor: HKQueryAnchor?

    func application(_ application: UIApplication,
                    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        // Request HealthKit permissions first
        requestHealthKitAuthorization()

        // Set up background delivery for workouts
        setupBackgroundDelivery()

        return true
    }

    func setupBackgroundDelivery() {
        let workoutType = HKObjectType.workoutType()

        // Enable background delivery
        healthStore.enableBackgroundDelivery(for: workoutType,
                                             frequency: .immediate) { success, error in
            if let error = error {
                print("Failed to enable background delivery: \\(error.localizedDescription)")
                return
            }
            print("Background delivery enabled for workouts")
        }

        // Create observer query
        let observerQuery = HKObserverQuery(sampleType: workoutType,
                                           predicate: nil) { [weak self] query, completionHandler, error in

            if let error = error {
                print("Observer query error: \\(error.localizedDescription)")
                completionHandler()
                return
            }

            print("New workout data detected - triggering sync")

            // Fetch the actual new data
            self?.fetchAndSyncNewWorkouts {
                // CRITICAL: Must call completion handler
                completionHandler()
            }
        }

        // Execute the observer query
        healthStore.execute(observerQuery)
    }

    func fetchAndSyncNewWorkouts(completion: @escaping () -> Void) {
        let workoutType = HKObjectType.workoutType()

        // Use HKAnchoredObjectQuery to get actual data
        let query = HKAnchoredObjectQuery(
            type: workoutType,
            predicate: nil,
            anchor: workoutsAnchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] query, newSamples, deletedSamples, newAnchor, error in

            guard let workouts = newSamples as? [HKWorkout] else {
                completion()
                return
            }

            // Save new anchor for next query
            self?.workoutsAnchor = newAnchor

            // Process new workouts
            print("Found \\(workouts.count) new workouts")

            // Sync to your backend
            self?.syncWorkoutsToBackend(workouts) {
                completion()
            }
        }

        healthStore.execute(query)
    }

    func syncWorkoutsToBackend(_ workouts: [HKWorkout], completion: @escaping () -> Void) {
        // Your backend sync logic here
        // Keep this fast - you have limited background time

        Task {
            // Make API calls to your backend
            // ...

            completion()
        }
    }
}
```

**Modern Async/Await Pattern (iOS 15+):**
```swift
func enableBackgroundWorkoutUpdates() async {
    let workoutType = HKObjectType.workoutType()

    do {
        try await healthStore.enableBackgroundDelivery(
            for: workoutType,
            frequency: .immediate
        )

        let observerQuery = HKObserverQuery(
            sampleType: workoutType,
            predicate: nil
        ) { [weak self] query, completion, error in

            if let error = error {
                print(error.localizedDescription)
                completion()
                return
            }

            Task {
                await self?.fetchNewWorkouts()
                completion()
            }
        }

        healthStore.execute(observerQuery)

    } catch {
        print("Failed to enable background delivery: \\(error.localizedDescription)")
    }
}

func fetchNewWorkouts() async {
    let workoutPredicate = HKQuery.predicateForWorkouts(with: .running)

    let query = HKAnchoredObjectQueryDescriptor(
        predicates: [.workout(workoutPredicate)],
        anchor: workoutsAnchor
    )

    do {
        let result = try await query.result(for: healthStore)
        workoutsAnchor = result.newAnchor

        let newWorkouts = result.addedSamples
        print("Syncing \\(newWorkouts.count) new workouts")

        // Sync to backend
        await syncToBackend(workouts: newWorkouts)

    } catch {
        print(error.localizedDescription)
    }
}
```

---

### 2. Background App Refresh (BGAppRefreshTask)

#### How It Works
- Schedule periodic background refresh tasks using BackgroundTasks framework
- iOS decides when to run your task based on system heuristics
- Task executes with 30 seconds maximum runtime
- Can query HealthKit and sync data during this window

#### Frequency & Reliability
- **Extremely Unpredictable** - no guaranteed frequency
- May run anywhere from every few hours to once a day, or not at all
- **User Usage Patterns:** iOS prioritizes frequently-used apps
- **Force Quit = No Execution:** If user force quits app, tasks won't run
- **Low Power Mode:** Tasks are deprioritized or skipped
- iOS learns usage patterns and schedules accordingly

#### Battery Impact
- **Medium** - 30-second execution windows add up
- iOS manages to preserve battery but less optimized than HealthKit-native approach

#### Setup Complexity
- **Medium**
- Requires BackgroundTasks framework knowledge
- Must test with special Xcode debugger commands (doesn't run naturally during testing)
- Registration and scheduling logic needed

#### Limitations & Caveats
1. **30-Second Limit:** Task must complete within 30 seconds or it's killed
2. **No Frequency Guarantee:** Can't rely on hourly or even daily execution
3. **One Task Only:** Can only register one BGAppRefreshTask
4. **Force Quit Kills It:** User swiping away your app prevents execution
5. **Not Suitable for Critical Syncs:** Too unreliable for time-sensitive data
6. **No HealthKit Wake-Up:** Won't wake when new health data is added
7. **Testing Pain:** Requires debugger commands to simulate, doesn't work naturally

#### Code Requirements

**Info.plist:**
```xml
<key>UIBackgroundModes</key>
<array>
    <string>processing</string>
</array>

<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.yourapp.refresh</string>
</array>
```

**Implementation:**
```swift
import BackgroundTasks

// In AppDelegate
func application(_ application: UIApplication,
                didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

    BGTaskScheduler.shared.register(
        forTaskWithIdentifier: "com.yourapp.refresh",
        using: nil
    ) { task in
        self.handleAppRefresh(task: task as! BGAppRefreshTask)
    }

    return true
}

func handleAppRefresh(task: BGAppRefreshTask) {
    // Schedule next refresh
    scheduleAppRefresh()

    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1

    let syncOperation = BlockOperation {
        // Sync HealthKit data
        self.syncHealthKitData()
    }

    task.expirationHandler = {
        queue.cancelAllOperations()
    }

    syncOperation.completionBlock = {
        task.setTaskCompleted(success: !syncOperation.isCancelled)
    }

    queue.addOperation(syncOperation)
}

func scheduleAppRefresh() {
    let request = BGAppRefreshTaskRequest(identifier: "com.yourapp.refresh")
    request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60) // 1 hour

    do {
        try BGTaskScheduler.shared.submit(request)
    } catch {
        print("Could not schedule app refresh: \\(error)")
    }
}
```

**Verdict:** NOT RECOMMENDED for HealthKit syncing due to unreliability and lack of health data triggers.

---

### 3. Silent Push Notifications

#### How It Works
- Backend server sends silent push notification to device
- iOS wakes app in background to process notification payload
- App can query HealthKit and sync data

#### Frequency & Reliability
- **Throttled by Apple:** Maximum ~2 per hour
- **Low Priority:** Treated as low priority, may be delayed or dropped
- **Not Guaranteed:** Apple makes no delivery guarantees
- System may throttle more aggressively if too many sent

#### Battery Impact
- **Low to Medium** - depends on backend notification frequency
- Network wake-ups consume power

#### Setup Complexity
- **High**
- Requires backend server infrastructure
- APNs (Apple Push Notification service) setup and certificates
- More complex than HealthKit-native solutions

#### Limitations & Caveats
1. **Rate Limited:** Approximately 2 per hour maximum
2. **No Delivery Guarantee:** Apple explicitly states these are not guaranteed
3. **Low Priority:** Deprioritized by system
4. **Backend Dependency:** Requires server infrastructure
5. **Wrong Tool:** Not designed for this use case - Apple warns against using for content refresh
6. **No Health Data Context:** Backend doesn't know when workouts complete

#### Code Requirements

**Backend sends silent push:**
```json
{
  "aps": {
    "content-available": 1,
    "sound": ""
  },
  "custom-key": "custom-value"
}
```

**iOS handles notification:**
```swift
func application(_ application: UIApplication,
                didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {

    // Sync HealthKit data
    syncHealthKitData { success in
        if success {
            completionHandler(.newData)
        } else {
            completionHandler(.failed)
        }
    }
}
```

**Verdict:** NOT RECOMMENDED - too limited, requires backend infrastructure, doesn't align with health data events.

---

### 4. Background Processing Tasks (BGProcessingTask)

#### How It Works
- Similar to BGAppRefreshTask but for longer-running processing
- Can run for several minutes
- Typically runs when device is charging and on WiFi
- Good for bulk data processing or ML tasks

#### Frequency & Reliability
- **Very Infrequent** - may run once per day or less
- iOS prioritizes charging + WiFi conditions
- Even less predictable than BGAppRefreshTask

#### Battery Impact
- **Low** - only runs during ideal conditions (charging)

#### Setup Complexity
- **Medium** - similar to BGAppRefreshTask

#### Limitations & Caveats
1. **Too Infrequent:** Not suitable for regular hourly syncing
2. **Charging Preference:** Typically waits for device to be charging
3. **WiFi Preference:** Prefers WiFi connectivity
4. **No HealthKit Trigger:** Doesn't wake when new health data added
5. **Overkill:** Designed for intensive processing, not simple sync

**Verdict:** NOT RECOMMENDED - designed for different use case (batch processing, ML training), too infrequent for regular sync.

---

### 5. Combining Approaches (Not Recommended for MVP)

Some developers combine multiple strategies:
- HealthKit Background Delivery as primary mechanism
- BGAppRefreshTask as backup for periodic "full sync"
- Local notifications to encourage user to open app

**Complexity:** High
**Benefit:** Marginal improvement over HealthKit Background Delivery alone
**Recommendation:** Start with pure HealthKit Background Delivery, only add complexity if proven necessary

---

## Detailed Comparison Matrix

| Feature | HealthKit Background Delivery | BGAppRefreshTask | Silent Push | BGProcessingTask |
|---------|------------------------------|------------------|-------------|------------------|
| **Triggers on new health data** | Yes | No | No | No |
| **Works when app terminated** | Yes | Yes (if not force quit) | Yes | Yes (if not force quit) |
| **Frequency (best case)** | Hourly | Unpredictable | ~2/hour | Daily or less |
| **Frequency (typical)** | 1-4x per day | 0-3x per day | Limited | 0-1x per day |
| **Works when locked** | No (fires on unlock) | Yes | Yes | Yes |
| **Battery efficiency** | High (iOS managed) | Medium | Medium | High (charging only) |
| **Requires backend** | No | No | Yes | No |
| **Setup complexity** | Medium | Medium | High | Medium |
| **Reliability for health sync** | High | Low | Low | Very Low |
| **Apple's intended use case** | Health data sync | Content refresh | Not for refresh | Batch processing |
| **Max execution time** | Few seconds | 30 seconds | 30 seconds | Several minutes |
| **Testing difficulty** | Medium | High | Medium | High |

---

## RECOMMENDED IMPLEMENTATION STRATEGY

### For MVP (Minimum Viable Product)

**Use HealthKit Background Delivery with HKObserverQuery exclusively.**

**Why:**
1. Native, Apple-designed solution for exactly this use case
2. Most reliable for capturing new workouts and health data
3. Battery-efficient - iOS manages execution intelligently
4. No backend dependency
5. Works from terminated state
6. Simplest architecture

**What to sync:**
- Workouts (`.immediate` frequency)
- Activity Rings / Active Energy (`.hourly` frequency)
- Steps (`.hourly` frequency)
- Heart Rate (`.immediate` frequency if needed)
- Other metrics as required

**Implementation checklist:**
- [ ] Add HealthKit capability to project
- [ ] Add Background Delivery entitlement
- [ ] Add "Background Modes - Processing" capability
- [ ] Request HealthKit permissions for needed types
- [ ] Set up HKObserverQuery in AppDelegate's `didFinishLaunchingWithOptions`
- [ ] Enable background delivery for each data type
- [ ] Implement HKAnchoredObjectQuery to fetch actual data when observer fires
- [ ] Always call completion handler in observer
- [ ] Keep sync logic fast and efficient
- [ ] Store anchor values persistently (UserDefaults or Core Data)
- [ ] Handle errors gracefully
- [ ] Test on real device (simulator doesn't support background delivery)

### User Expectations to Set

Be transparent with users about how background sync actually works:

**Good messaging:**
> "Your workout data syncs automatically in the background. Sync happens when new workouts are detected, typically within an hour of completion. For best results, keep your device unlocked and charged. You can also manually sync anytime by opening the app."

**Bad messaging:**
> "Your data syncs every hour automatically" (this is not guaranteed)

### Handling the Device Lock Issue

Since background delivery doesn't work when device is locked:

**Strategy 1:** Accept the limitation
- Most users unlock their phone regularly
- Data will sync upon next unlock
- Simple, no additional complexity

**Strategy 2:** Local notification reminder (optional enhancement)
```swift
// After workout detected but device locked, schedule local notification
func scheduleUnlockReminder() {
    let content = UNMutableNotificationContent()
    content.title = "Sync Your Workout"
    content.body = "Unlock your device to sync your latest workout data"

    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: false)
    let request = UNNotificationRequest(identifier: "sync-reminder",
                                       content: content,
                                       trigger: trigger)

    UNUserNotificationCenter.current().add(request)
}
```

**Strategy 3:** Educate users to disable passcode (not recommended)
- Poor security practice
- Most users won't do this

---

## Testing Background Delivery

**Critical:** Background delivery does NOT work in iOS Simulator. Must test on real device.

### Testing Steps

1. **Install app on physical device** via Xcode

2. **Grant HealthKit permissions**

3. **Force app to background** (home button/swipe)

4. **Add workout data** to HealthKit:
   - Use Apple Fitness/Health app to log workout
   - Use another fitness app
   - Use Apple Watch to complete workout

5. **Check device unlocked state**

6. **Wait for background wake-up** (may take several minutes)

7. **Check Xcode console** for logs while device is connected

### Debugging Tips

```swift
// Add extensive logging to track background wake-ups
func setupBackgroundDelivery() {
    print("[Background] Setting up observer at \\(Date())")

    let observerQuery = HKObserverQuery(sampleType: workoutType, predicate: nil) { query, completion, error in
        print("[Background] Observer fired at \\(Date())")
        print("[Background] Device locked: \\(UIDevice.current.isProtectedDataAvailable)")

        // Your sync logic

        completion()
        print("[Background] Completion handler called at \\(Date())")
    }

    healthStore.execute(observerQuery)
}
```

### Simulating Background Delivery

You cannot reliably simulate background delivery. You MUST:
- Test on real device
- Add real workout data
- Wait for actual background wake-up
- Be patient (may take 15-60 minutes)

---

## Potential Gotchas & Solutions

### Gotcha 1: Background Delivery Stops Working
**Symptoms:** Was working, then stopped
**Causes:**
- App was force quit by user
- Didn't call completion handler properly
- Hit 3-failure limit (Apple's backoff algorithm)
- HealthKit permissions revoked

**Solutions:**
- Always call completion handler
- Re-register observer queries on each app launch
- Check permission status and re-request if needed
- Add error handling and logging

### Gotcha 2: Delayed Syncing
**Symptoms:** Data takes hours to sync
**Causes:**
- Device is locked
- Low Power Mode enabled
- iOS deferring due to battery/CPU
- User doesn't use app frequently

**Solutions:**
- This is expected behavior - set proper user expectations
- Provide manual sync button
- Send local notification to encourage opening app
- Accept the limitation

### Gotcha 3: Observer Fires But No New Data
**Symptoms:** Observer callback runs but HKAnchoredObjectQuery returns no new samples
**Causes:**
- Observer is "advisory" - may fire without actual changes
- Data was deleted, not added
- Race condition in query timing

**Solutions:**
- Always check if addedSamples is empty before syncing
- Log both added and deleted samples
- Handle deletedSamples array appropriately

### Gotcha 4: Crashes During Background Execution
**Symptoms:** App crashes when woken in background
**Causes:**
- Accessing UI from background thread
- Force unwrapping nil values
- HealthKit store encrypted (device locked)

**Solutions:**
- Never update UI from background callbacks
- Use safe unwrapping (guard/if let)
- Check `UIDevice.current.isProtectedDataAvailable` before querying
- Catch and handle all errors

---

## Architecture Recommendations

### Data Flow

```
HealthKit Data Added
        ↓
iOS Wakes App (background delivery)
        ↓
HKObserverQuery Fires
        ↓
Run HKAnchoredObjectQuery
        ↓
Get New Samples (using saved anchor)
        ↓
Save New Anchor
        ↓
Transform to Backend Model
        ↓
POST to Backend API
        ↓
Call Completion Handler
        ↓
App Suspends
```

### State Management

**Store these persistently:**
- Query anchors for each data type (HKQueryAnchor)
- Last successful sync timestamp
- Pending uploads (for retry logic)
- User preferences (sync frequency, data types)

**Use:**
- UserDefaults for anchors and timestamps
- Core Data or Realm for pending uploads queue
- Keychain for API tokens

### API Design

**Backend endpoint example:**
```
POST /api/v1/sync/workouts
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "workouts": [
    {
      "id": "UUID-from-healthkit",
      "type": "running",
      "startDate": "2025-10-11T10:00:00Z",
      "endDate": "2025-10-11T10:30:00Z",
      "duration": 1800,
      "distance": 5000,
      "activeEnergy": 400,
      "metadata": {...}
    }
  ],
  "syncedAt": "2025-10-11T10:32:00Z",
  "deviceId": "user-device-id"
}
```

**Handle idempotency:**
- Use HealthKit's UUID as idempotency key
- Backend should handle duplicate submissions gracefully
- Return 200 OK even if workout already exists

### Error Handling

```swift
func syncWorkoutsToBackend(_ workouts: [HKWorkout], completion: @escaping () -> Void) {
    guard !workouts.isEmpty else {
        completion()
        return
    }

    Task {
        do {
            let data = try transformWorkouts(workouts)
            try await apiClient.uploadWorkouts(data)

            // Mark as synced
            await markWorkoutsSynced(workouts)

        } catch {
            // Log error but still call completion
            print("Sync failed: \\(error)")

            // Queue for retry
            await queueForRetry(workouts)
        }

        // Always call completion
        completion()
    }
}
```

---

## Alternative Approaches for Consideration

### If Background Delivery Proves Insufficient

If after implementation you find background delivery is too unreliable:

**Option A: Add BGAppRefreshTask as backup**
- Primary: HealthKit Background Delivery
- Fallback: BGAppRefreshTask every 4-6 hours to catch missed data
- Complexity: Medium
- Benefit: Catches data that was missed during device lock

**Option B: Encourage user engagement**
- Send local notification after workout completion
- "Your workout has been recorded - tap to view details"
- User opens app, triggering foreground sync
- Complexity: Low
- Benefit: Leverages existing user behavior

**Option C: Server-initiated sync**
- Silent push from server when other data suggests workout may have occurred
- Example: User's Apple Watch uploaded workout to iCloud
- Complexity: Very High
- Benefit: Can trigger sync proactively
- Drawback: Requires integration with Apple's ecosystem, may not be feasible

---

## Code Template: Complete Implementation

```swift
// AppDelegate.swift
import UIKit
import HealthKit
import BackgroundTasks

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    let healthStore = HKHealthStore()
    let syncManager = HealthKitSyncManager.shared

    func application(_ application: UIApplication,
                    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        // Initialize sync manager
        syncManager.initialize(healthStore: healthStore)

        // Set up background observers
        setupBackgroundObservers()

        return true
    }

    private func setupBackgroundObservers() {
        // Set up observers for each data type
        syncManager.setupObserver(for: .workoutType())
        syncManager.setupObserver(for: .quantityType(forIdentifier: .stepCount)!)
        syncManager.setupObserver(for: .quantityType(forIdentifier: .activeEnergyBurned)!)
        syncManager.setupObserver(for: .quantityType(forIdentifier: .heartRate)!)
    }
}

// HealthKitSyncManager.swift
import HealthKit
import Foundation

class HealthKitSyncManager {
    static let shared = HealthKitSyncManager()
    private var healthStore: HKHealthStore?
    private var observerQueries: [HKObjectType: HKObserverQuery] = [:]
    private var anchors: [HKObjectType: HKQueryAnchor] = [:]

    private init() {
        loadAnchors()
    }

    func initialize(healthStore: HKHealthStore) {
        self.healthStore = healthStore
    }

    // MARK: - Observer Setup

    func setupObserver(for sampleType: HKSampleType) {
        guard let store = healthStore else {
            print("HealthStore not initialized")
            return
        }

        // Enable background delivery
        let frequency: HKUpdateFrequency = {
            if sampleType == .workoutType() {
                return .immediate
            } else {
                return .hourly
            }
        }()

        store.enableBackgroundDelivery(for: sampleType, frequency: frequency) { success, error in
            if let error = error {
                print("Failed to enable background delivery for \\(sampleType): \\(error)")
                return
            }
            print("Background delivery enabled for \\(sampleType)")
        }

        // Create observer query
        let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] query, completion, error in

            guard let self = self else {
                completion()
                return
            }

            if let error = error {
                print("Observer error for \\(sampleType): \\(error)")
                completion()
                return
            }

            print("Observer fired for \\(sampleType) at \\(Date())")

            // Fetch new data
            Task {
                await self.fetchNewData(for: sampleType)
                completion()
            }
        }

        // Store query reference
        observerQueries[sampleType] = query

        // Execute query
        store.execute(query)

        print("Observer set up for \\(sampleType)")
    }

    // MARK: - Data Fetching

    private func fetchNewData(for sampleType: HKSampleType) async {
        guard let store = healthStore else { return }

        let anchor = anchors[sampleType]

        return await withCheckedContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: nil,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { [weak self] query, newSamples, deletedSamples, newAnchor, error in

                guard let self = self else {
                    continuation.resume()
                    return
                }

                if let error = error {
                    print("Anchored query error: \\(error)")
                    continuation.resume()
                    return
                }

                // Update anchor
                if let newAnchor = newAnchor {
                    self.anchors[sampleType] = newAnchor
                    self.saveAnchor(newAnchor, for: sampleType)
                }

                // Process new samples
                if let samples = newSamples, !samples.isEmpty {
                    print("Found \\(samples.count) new samples for \\(sampleType)")

                    Task {
                        await self.processSamples(samples, type: sampleType)
                        continuation.resume()
                    }
                } else {
                    print("No new samples for \\(sampleType)")
                    continuation.resume()
                }
            }

            store.execute(query)
        }
    }

    // MARK: - Sample Processing

    private func processSamples(_ samples: [HKSample], type: HKSampleType) async {
        // Transform to your model
        if type == .workoutType() {
            let workouts = samples.compactMap { $0 as? HKWorkout }
            await syncWorkouts(workouts)
        } else if let quantityType = type as? HKQuantityType {
            let quantitySamples = samples.compactMap { $0 as? HKQuantitySample }
            await syncQuantitySamples(quantitySamples, type: quantityType)
        }
    }

    private func syncWorkouts(_ workouts: [HKWorkout]) async {
        print("Syncing \\(workouts.count) workouts to backend")

        do {
            // Transform to your API model
            let workoutData = workouts.map { workout in
                return [
                    "id": workout.uuid.uuidString,
                    "type": workout.workoutActivityType.rawValue,
                    "startDate": workout.startDate.timeIntervalSince1970,
                    "endDate": workout.endDate.timeIntervalSince1970,
                    "duration": workout.duration,
                    "distance": workout.totalDistance?.doubleValue(for: .meter()) ?? 0,
                    "energy": workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0
                ] as [String: Any]
            }

            // Call your API
            try await BackendAPI.shared.uploadWorkouts(workoutData)
            print("Successfully synced workouts")

        } catch {
            print("Failed to sync workouts: \\(error)")
            // Could queue for retry here
        }
    }

    private func syncQuantitySamples(_ samples: [HKQuantitySample], type: HKQuantityType) async {
        print("Syncing \\(samples.count) \\(type) samples to backend")

        // Similar to workout sync
        // Transform and upload to your backend
    }

    // MARK: - Anchor Persistence

    private func loadAnchors() {
        // Load saved anchors from UserDefaults or Core Data
        if let anchorData = UserDefaults.standard.data(forKey: "healthkit.anchors") {
            do {
                if let decoded = try NSKeyedUnarchiver.unarchivedObject(
                    ofClasses: [NSDictionary.self, HKQueryAnchor.self, NSString.self],
                    from: anchorData
                ) as? [String: HKQueryAnchor] {
                    // Convert string keys back to HKObjectType
                    // This is simplified - you'd need proper conversion logic
                    print("Loaded \\(decoded.count) anchors")
                }
            } catch {
                print("Failed to load anchors: \\(error)")
            }
        }
    }

    private func saveAnchor(_ anchor: HKQueryAnchor, for type: HKObjectType) {
        // Save to persistent storage
        // Simplified example
        do {
            let encoded = try NSKeyedArchiver.archivedData(
                withRootObject: anchor,
                requiringSecureCoding: true
            )
            UserDefaults.standard.set(encoded, forKey: "anchor.\\(type.identifier)")
        } catch {
            print("Failed to save anchor: \\(error)")
        }
    }
}

// BackendAPI.swift
class BackendAPI {
    static let shared = BackendAPI()

    func uploadWorkouts(_ workouts: [[String: Any]]) async throws {
        // Your API implementation
        guard let url = URL(string: "https://your-api.com/sync/workouts") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \\(getAuthToken())", forHTTPHeaderField: "Authorization")

        let payload: [String: Any] = [
            "workouts": workouts,
            "syncedAt": Date().timeIntervalSince1970,
            "deviceId": UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        print("Upload successful")
    }

    private func getAuthToken() -> String {
        // Retrieve from Keychain
        return "user-auth-token"
    }
}
```

---

## Summary & Final Recommendation

**For your HealthKit fitness data extraction app with automatic background sync:**

**SOLUTION:** Implement HealthKit Background Delivery with HKObserverQuery + HKAnchoredObjectQuery

**RATIONALE:**
1. Only solution that wakes app when new health data is written
2. Most reliable for catching workout completions
3. Battery-efficient and system-managed
4. No backend infrastructure required
5. Apple's intended pattern for this exact use case
6. Works from terminated state (unlike force quit)
7. Simpler architecture than hybrid approaches

**ACCEPT THESE LIMITATIONS:**
1. Not guaranteed hourly - actual frequency varies (1-4x per day typical)
2. Requires device to be unlocked
3. Not real-time - "shortly after" data is written
4. iOS controls execution timing based on system conditions

**PROVIDE USER VALUE:**
1. Manual sync button for immediate sync
2. Clear messaging about background sync behavior
3. Last sync timestamp displayed in UI
4. Success/error feedback

**DO NOT:**
- Promise hourly sync in marketing
- Rely on exact timing for critical features
- Implement complex hybrid solutions until proven necessary
- Use silent push or BGAppRefreshTask as primary mechanism

**START SIMPLE, ITERATE BASED ON DATA:**
- Ship with HealthKit Background Delivery only
- Monitor sync frequency and reliability
- Collect user feedback
- Add complexity (BGAppRefreshTask backup) only if data shows it's needed

---

## References & Resources

### Official Apple Documentation
- HealthKit Framework: https://developer.apple.com/documentation/healthkit
- HKObserverQuery: https://developer.apple.com/documentation/healthkit/hkobserverquery
- enableBackgroundDelivery: https://developer.apple.com/documentation/healthkit/hkhealthstore/1614175-enablebackgrounddelivery
- Background Execution: https://developer.apple.com/documentation/uikit/app_and_environment/scenes/preparing_your_ui_to_run_in_the_background
- BackgroundTasks Framework: https://developer.apple.com/documentation/backgroundtasks

### WWDC Sessions
- WWDC 2020: Synchronize health data with HealthKit (Session 10184)
- WWDC 2022: What's new in HealthKit (Session 10005)

### Community Resources
- Stack Overflow: "Healthkit background delivery when app is not running"
- GitHub Gist: HKObserverQuery Examples by @phatblat
- iTwenty's Blog: "Read workouts using Healthkit - and keep them updated!"

### Testing Tools
- Xcode Instruments for monitoring background execution
- Console.app for viewing device logs
- Health app for adding test data

---

**Document Version:** 1.0
**Last Updated:** October 11, 2025
**Author:** Research compiled for fitness-extractor project
