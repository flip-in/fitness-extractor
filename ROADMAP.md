# Fitness Extractor - Development Roadmap

**Project Start:** 2025-10-11
**Current Phase:** Phase 1 - Backend Foundation
**Last Updated:** 2025-10-11

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
**Status:** Not Started

- [ ] Create Xcode project
- [ ] HealthKit entitlements and permissions
- [ ] HealthKit data extraction implementation
- [ ] Background sync with HKObserverQuery
- [ ] Manual sync UI
- [ ] 90-day historical import
- [ ] API client implementation
- [ ] Test on real device

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
- [ ] **M2:** iOS app can sync workouts to backend
- [ ] **M3:** Dashboard displays workout data
- [ ] **M4:** GPS routes render on map
- [ ] **M5:** Background sync working reliably
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
