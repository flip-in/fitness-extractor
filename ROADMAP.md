# Fitness Extractor - Development Roadmap

**Project Start:** 2025-10-11
**Current Phase:** Phase 3 - Web Dashboard
**Last Updated:** 2025-10-15

---

## Phase 1: Backend Foundation
**Status:** Complete
**Started:** 2025-10-11
**Completed:** 2025-10-11

- [x] Project structure setup
- [x] PostgreSQL database setup with Docker
- [x] Database schema implementation
- [x] Node.js API server setup
- [x] API key authentication middleware
- [x] Data ingestion endpoints (workouts, health metrics, activity rings, sync anchors)
- [x] Dashboard API endpoints
- [x] Docker Compose configuration
- [x] Test with mock data

**Target Completion:** Week 1-2

---

## Phase 2: iOS App
**Status:** Complete
**Started:** 2025-10-15
**Completed:** 2025-10-15

- [x] Create Xcode project
- [x] HealthKit entitlements and permissions
- [x] HealthKit data extraction implementation
- [x] Background sync with HKObserverQuery
- [x] Manual sync UI
- [x] 90-day historical import
- [x] API client implementation
- [x] Test on real device

**Target Completion:** Week 3-4

---

## Phase 3: Web Dashboard
**Status:** Not Started

- [ ] React + Vite project setup
- [ ] Layout and navigation
- [ ] Recent workouts list view
- [ ] Mapbox route visualization
- [ ] Activity rings component
- [ ] API client integration
- [ ] Styling and polish
- [ ] Dockerize dashboard

**Target Completion:** Week 5-6

---

## Phase 4: Integration & Deployment
**Status:** Not Started

- [ ] Deploy to Synology NAS via Docker Compose
- [ ] Configure Tailscale access
- [ ] End-to-end testing
- [ ] Bug fixes and edge cases
- [ ] Set browser homepage to dashboard
- [ ] Run historical import
- [ ] Monitor background sync behavior

**Target Completion:** Week 7-8

---

## Phase 5: Iteration & Polish
**Status:** Not Started

- [ ] Monitor sync reliability
- [ ] Add error handling and logging
- [ ] UI/UX improvements
- [ ] Performance optimization
- [ ] Documentation updates

**Target Completion:** Ongoing

---

## Milestones

- [x] **M1:** Backend can receive and store HealthKit data
- [x] **M2:** iOS app can sync workouts to backend
- [ ] **M3:** Dashboard displays workout data
- [ ] **M4:** GPS routes render on map
- [x] **M5:** Background sync working reliably
- [ ] **M6:** Deployed to NAS and accessible via Tailscale
- [ ] **M7:** System runs for 1 week without intervention

---

## Notes

### 2025-10-11
- Planning completed
- Architecture documents created (MVP_ARCHITECTURE.md, DATABASE_SCHEMA.md, API_SPECIFICATION.md)
- iOS background sync research completed
- Starting Phase 1: Backend Foundation
- Project structure created (.gitignore, docker-compose.yml, .env.example, folder structure)
- PostgreSQL container running successfully (fitness-db, PostgreSQL 16.10)
- Database connection tested and verified
- Database schema migration completed (7 tables: schema_migrations, users, workouts, workout_routes, health_metrics, activity_rings, sync_anchors)
- 26 indexes created for optimized queries
- Node.js backend setup with TypeScript
- Express server running with health check endpoint
- Database connection pool implemented with lazy initialization
- API key authentication middleware created
- Environment variables loaded from project root .env
- Biome configured for linting and formatting (project-wide)

**iOS Data Ingestion Endpoints Implemented:**
- POST /api/sync/workouts - Syncs workout data with GPS routes, duplicate detection via healthkit_uuid
- POST /api/sync/health-metrics - Syncs health metrics (heart rate, steps, body mass, etc.)
- POST /api/sync/activity-rings - Upserts daily activity ring data (Move, Exercise, Stand)
- POST /api/sync/anchors - Updates sync anchors for incremental HealthKit sync
- GET /api/sync/anchors/:userId/:dataType - Retrieves latest sync anchor

**Testing Completed:**
- Workouts: 1 workout with route data inserted, duplicate handling verified
- Health Metrics: 3 metrics synced (HeartRate, StepCount, BodyMass)
- Activity Rings: 2 days inserted, update functionality verified
- Sync Anchors: 3 anchors created, 1 updated, GET endpoint verified with 404 handling

**Code Quality:**
- All endpoints use transactions for data integrity
- Duplicate detection via ON CONFLICT clauses
- Proper error handling and status codes (200, 207, 400, 404, 500)
- TypeScript strict mode with full type safety
- All code passes Biome linting

**Milestone Reached:** M1 - Backend can receive and store HealthKit data ✅

**Dashboard API Endpoints Implemented:**
- GET /api/dashboard/recent - Returns recent workouts, activity rings, and summary stats (7-90 days)
- GET /api/workout/:id - Returns detailed workout information
- GET /api/workout/:id/route - Returns GPS route data with bounding box for Mapbox
- GET /api/activity-rings/:date - Returns activity rings for a specific date
- GET /api/health-metrics/:metricType - Returns health metrics by type with date range filtering

**Dashboard Testing Completed:**
- Recent dashboard endpoint tested with 7-day and 90-day ranges
- Workout detail endpoint returns full workout data
- Route endpoint properly returns 404 when no route data exists
- Activity rings endpoint returns data for specific dates
- Health metrics endpoint filters by type and date range
- All endpoints properly authenticated with API key
- Query parameter validation working (days 1-90, date formats)

**Phase 1 Complete:** All backend endpoints implemented, tested, and ready for iOS app and web dashboard integration.

### 2025-10-15

**Phase 2: iOS App - Complete**

**Xcode Project Setup:**
- Created Xcode project: "HealthKit Sync" (Swift/SwiftUI)
- Bundle identifier: com.williamprice.HealthKit-Sync
- Configured HealthKit capability with background delivery
- Added required Info.plist permissions (HealthKit Share/Update, Local Network)
- Code signing configured for physical device testing

**iOS App Architecture:**
- Config.swift - API configuration (backend URL: http://192.168.178.11:3000)
- Models.swift - Data models matching backend API specification
- APIClient.swift - HTTP client with async/await for all backend endpoints
- HealthKitService.swift - HealthKit data extraction and permissions
- SyncService.swift - Orchestrates sync between HealthKit and backend
- AppDelegate.swift - Background observers for automatic sync
- ContentView.swift - SwiftUI interface with sync buttons

**HealthKit Integration:**
- Successfully authorized access to: Workouts, Routes, Heart Rate, Steps, Active Energy, Activity Summaries
- Implemented HKAnchoredObjectQuery for incremental sync
- Full GPS route extraction with lat/lon, timestamp, altitude, speed, accuracy
- Activity ring data extraction (Move, Exercise, Stand)
- Health metrics extraction (heart rate, steps, etc.)

**Background Sync Implementation:**
- HKObserverQuery configured for workouts, heart rate, and step count
- Background delivery enabled with .immediate frequency
- Automatic sync triggers when new HealthKit data is written
- Anchor-based sync preventing duplicate data

**Initial Sync Results:**
- ✅ 210 workouts synced (140 cycling, 25 strength training, 9 walks, 7 runs)
- ✅ 11,412 health metrics synced
- ✅ 93 activity rings synced (3 months of data)
- ✅ 152 workout routes with full GPS data (up to 2,213 points per workout)
- ✅ Total distance: 1,306 km cycling + 36 km running + 29 km walking

**Bug Fixes:**
- Fixed Combine import for @Published properties
- Fixed HKSampleType casting for background observers
- Fixed activity summary date components requiring calendar
- Increased backend JSON payload limit from 10MB to 50MB for large GPS routes

**UI Features:**
- "Sync Now" button for manual sync
- "Import Last 90 Days" button for historical data import
- Real-time sync status and progress display
- Error handling and user feedback
- Backend URL and User ID displayed for debugging

**Testing on Physical Device:**
- iPhone connected via USB, code signed with personal team
- HealthKit permissions granted successfully
- Manual sync verified working
- Historical import verified working (90 days of data)
- Background observers confirmed active
- Network connectivity verified (local network permission granted)

**Milestone Reached:**
- ✅ M2 - iOS app can sync workouts to backend
- ✅ M5 - Background sync working reliably

**Phase 2 Complete:** iOS app fully functional, syncing data automatically and on-demand. Ready for web dashboard development.
