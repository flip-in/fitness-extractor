# Fitness Extractor - Development Roadmap

**Project Start:** 2025-10-11
**Current Phase:** Phase 1 - Backend Foundation
**Last Updated:** 2025-10-11

---

## Phase 1: Backend Foundation
**Status:** In Progress
**Started:** 2025-10-11

- [x] Project structure setup
- [x] PostgreSQL database setup with Docker
- [x] Database schema implementation
- [ ] Node.js API server setup
- [ ] API key authentication middleware
- [ ] Data ingestion endpoints (workouts, health metrics, activity rings)
- [ ] Dashboard API endpoints
- [x] Docker Compose configuration
- [ ] Test with mock data

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

- [ ] **M1:** Backend can receive and store HealthKit data
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
