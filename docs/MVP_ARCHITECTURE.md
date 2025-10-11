# Fitness Extractor - MVP Architecture Plan

## Project Overview

Personal fitness data extraction system that syncs HealthKit data from iOS to a self-hosted backend, with a web dashboard for visualization.

**Primary User:** Single user (you)
**Deployment:** Docker on Synology NAS, accessed via Tailscale
**Key Principle:** Minimal viable product - prioritize working over perfect

---

## System Components

### 1. iOS App (Swift/SwiftUI)
- Native iOS application
- Connects to HealthKit
- Syncs data automatically in background using HealthKit Background Delivery
- Manual sync trigger option

### 2. Backend API (Node.js)
- Express.js REST API
- Simple API key authentication
- Handles data ingestion from iOS app
- Serves data to web dashboard
- Containerized with Docker

### 3. Database (PostgreSQL)
- Stores all fitness data
- Time-series optimized schema
- Containerized with Docker
- Persistent volume for data

### 4. Web Dashboard (React)
- Browser-based visualization
- Homepage on local network
- Shows last 7 days of activity
- GPS route visualization with Mapbox
- Activity rings display

---

## Architecture Diagram

```
┌─────────────────────┐
│   iOS Device        │
│  (HealthKit App)    │
│                     │
│  Background Sync    │
└──────────┬──────────┘
           │ HTTPS (Tailscale)
           │ API Key Auth
           ▼
┌─────────────────────────────────────┐
│   Synology NAS (Docker)             │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Node.js API Container      │   │
│  │  - Express.js               │   │
│  │  - API Key Middleware       │   │
│  │  - HealthKit Data Ingestion │   │
│  │  - Dashboard API Endpoints  │   │
│  └──────────┬──────────────────┘   │
│             │                       │
│             │ PostgreSQL Protocol   │
│             ▼                       │
│  ┌─────────────────────────────┐   │
│  │  PostgreSQL Container       │   │
│  │  - Fitness data storage     │   │
│  │  - Time-series schema       │   │
│  │  - Volume: /data            │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
           ▲
           │ HTTPS (Tailscale)
           │
┌──────────┴──────────┐
│   Browser           │
│  (Dashboard)        │
│  - Last 7 days view │
│  - Activity rings   │
│  - GPS maps         │
└─────────────────────┘
```

---

## Data Flow

### Background Sync (Primary Method)
1. New workout/health data added to HealthKit
2. iOS wakes app via HealthKit Background Delivery
3. App queries new data using HKAnchoredObjectQuery
4. App sends data to backend API with API key
5. Backend validates and stores in PostgreSQL
6. iOS app updates anchor for next sync

### Manual Sync (Backup Method)
1. User opens app and taps "Sync Now"
2. App queries all data since last anchor
3. Same flow as background sync

### Dashboard View
1. User opens browser (homepage set to dashboard)
2. Dashboard fetches last 7 days from API
3. Renders workouts, activity rings, GPS routes

### Historical Import (One-Time)
1. User taps "Import Historical Data" in app
2. App queries last 90 days from HealthKit
3. Sends data in batches to backend
4. Progress indicator shows completion

---

## Technology Stack

### iOS App
- **Language:** Swift 5.9+
- **UI Framework:** SwiftUI
- **iOS Version:** iOS 17+ (for latest HealthKit APIs)
- **Key Frameworks:**
  - HealthKit
  - BackgroundTasks
  - Combine (for async operations)

### Backend
- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js
- **Key Libraries:**
  - `express` - Web framework
  - `pg` - PostgreSQL client
  - `dotenv` - Environment configuration
  - `helmet` - Security headers
  - `cors` - CORS handling

### Database
- **Database:** PostgreSQL 16
- **Extensions:** None required for MVP (consider TimescaleDB later)

### Web Dashboard
- **Framework:** React 18
- **Build Tool:** Vite
- **Key Libraries:**
  - `react-router-dom` - Navigation
  - `mapbox-gl` - Map visualization
  - `recharts` - Charts/graphs
  - `date-fns` - Date formatting

### Infrastructure
- **Containerization:** Docker & Docker Compose
- **Networking:** Tailscale for secure access
- **Deployment:** Synology NAS

---

## MVP Feature Set

### Must Have (MVP)
- ✅ iOS app connects to HealthKit
- ✅ Extract workouts (runs, cycles, gym sessions)
- ✅ Extract health metrics (heart rate, steps, distance)
- ✅ Extract activity rings (move, exercise, stand)
- ✅ Background sync via HealthKit Background Delivery
- ✅ Manual sync button
- ✅ 90-day historical import
- ✅ API key authentication
- ✅ PostgreSQL storage
- ✅ Web dashboard showing last 7 days
- ✅ GPS route visualization on map (Mapbox)
- ✅ Activity rings display
- ✅ Docker deployment

### Nice to Have (Post-MVP)
- ⏭️ Nutrition data tracking
- ⏭️ Real-time sync with push notifications
- ⏭️ Dashboard filtering/date range selection
- ⏭️ Export data to CSV/JSON
- ⏭️ Workout analytics and trends
- ⏭️ Multi-device support
- ⏭️ TimescaleDB for time-series optimization

### Out of Scope (MVP)
- ❌ Multiple user support
- ❌ Web authentication UI
- ❌ Social features
- ❌ Third-party integrations
- ❌ Native Android app
- ❌ Cloud deployment

---

## Security & Privacy

### Authentication
- **iOS → Backend:** API key sent in `X-API-Key` header
- **Dashboard → Backend:** API key stored in localStorage (acceptable for single-user Tailscale setup)
- **Key Generation:** Generate on first deployment, store in `.env`

### Network Security
- **Transport:** HTTPS only (enforced by Tailscale)
- **Network Access:** Restricted to Tailscale network
- **No Public Internet Exposure:** All services behind Tailscale

### Data Privacy
- All data stored locally on your NAS
- No third-party analytics or tracking
- HealthKit data never leaves your control
- GDPR-compliant by design (you own all data)

---

## Database Schema Overview

See detailed schema in `docs/DATABASE_SCHEMA.md`

**Key Tables:**
- `users` - Single user record
- `workouts` - Individual workout sessions
- `workout_routes` - GPS coordinates for workouts
- `health_metrics` - Time-series health data points
- `activity_rings` - Daily activity ring data
- `sync_anchors` - Track HealthKit sync state

---

## API Specification Overview

See detailed API spec in `docs/API_SPECIFICATION.md`

**Key Endpoints:**
- `POST /api/sync/workouts` - Sync workout data
- `POST /api/sync/health-metrics` - Sync health metrics
- `POST /api/sync/activity-rings` - Sync activity rings
- `POST /api/sync/import-historical` - Historical data import
- `GET /api/dashboard/recent` - Get last 7 days data
- `GET /api/workout/:id/route` - Get GPS route for workout

---

## Development Roadmap

### Phase 1: Backend Foundation (Week 1-2)
1. Set up Node.js project structure
2. Implement PostgreSQL schema
3. Create Docker Compose configuration
4. Build API endpoints for data ingestion
5. Implement API key authentication
6. Test with mock data

### Phase 2: iOS App (Week 3-4)
1. Create Xcode project
2. Set up HealthKit entitlements and permissions
3. Implement HealthKit data extraction
4. Build background sync with HKObserverQuery
5. Create simple UI with manual sync button
6. Implement 90-day historical import
7. Test background sync on real device

### Phase 3: Web Dashboard (Week 5-6)
1. Set up React + Vite project
2. Create layout and navigation
3. Build recent workouts list view
4. Implement Mapbox route visualization
5. Create activity rings component
6. Style and polish UI
7. Containerize with Docker

### Phase 4: Integration & Deployment (Week 7-8)
1. Deploy to Synology NAS via Docker Compose
2. Configure Tailscale access
3. End-to-end testing
4. Fix bugs and edge cases
5. Set browser homepage to dashboard
6. Run historical import
7. Monitor background sync behavior

### Phase 5: Iteration & Polish (Ongoing)
1. Monitor sync reliability
2. Add error handling and logging
3. Improve UI/UX based on usage
4. Add nice-to-have features
5. Performance optimization

---

## Project Structure

```
fitness-extractor/
├── ios/                          # iOS app
│   ├── FitnessExtractor.xcodeproj
│   ├── FitnessExtractor/
│   │   ├── App/                  # App lifecycle
│   │   ├── Views/                # SwiftUI views
│   │   ├── Services/             # HealthKit, sync services
│   │   ├── Models/               # Data models
│   │   └── Utils/                # Helpers
│   └── FitnessExtractorTests/
│
├── backend/                      # Node.js API
│   ├── src/
│   │   ├── routes/               # API routes
│   │   ├── controllers/          # Request handlers
│   │   ├── services/             # Business logic
│   │   ├── middleware/           # Auth, error handling
│   │   ├── db/                   # Database connection
│   │   └── index.js              # Entry point
│   ├── migrations/               # DB migrations
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
│
├── dashboard/                    # React web app
│   ├── src/
│   │   ├── components/           # React components
│   │   ├── pages/                # Page components
│   │   ├── services/             # API client
│   │   ├── hooks/                # Custom hooks
│   │   ├── utils/                # Helpers
│   │   └── App.jsx
│   ├── public/
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.js
│
├── docs/                         # Documentation
│   ├── MVP_ARCHITECTURE.md       # This file
│   ├── DATABASE_SCHEMA.md        # Detailed schema
│   ├── API_SPECIFICATION.md      # API endpoints
│   └── ios-background-sync-research.md
│
├── docker-compose.yml            # Multi-container setup
├── .env.example                  # Environment template
└── README.md                     # Project overview
```

---

## Environment Configuration

### Backend `.env`
```
NODE_ENV=production
PORT=3000
API_KEY=<generate-random-key>
DATABASE_URL=postgresql://postgres:password@db:5432/fitness
CORS_ORIGIN=http://localhost:5173,http://your-nas-ip:5173
```

### Dashboard `.env`
```
VITE_API_URL=http://your-nas-ip:3000
VITE_API_KEY=<same-as-backend>
VITE_MAPBOX_TOKEN=<your-mapbox-token>
```

### iOS App Configuration
- Backend URL configured in `Config.swift`
- API key stored in Keychain
- Can be updated from settings screen

---

## Docker Compose Setup

```yaml
version: '3.8'

services:
  db:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: fitness
    restart: unless-stopped

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    depends_on:
      - db
    environment:
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@db:5432/fitness
      API_KEY: ${API_KEY}
    restart: unless-stopped

  dashboard:
    build: ./dashboard
    ports:
      - "5173:80"
    environment:
      VITE_API_URL: http://localhost:3000
      VITE_API_KEY: ${API_KEY}
    restart: unless-stopped

volumes:
  postgres_data:
```

---

## Testing Strategy

### iOS App Testing
- **Manual Testing:** Primary method for MVP
- **Real Device Required:** Background sync cannot be tested in simulator
- **Test Scenarios:**
  - Fresh install → permission flow
  - Background sync after workout
  - Manual sync button
  - Historical import (90 days)
  - Network failure handling

### Backend Testing
- **Manual API Testing:** Use Postman/curl
- **Test Data:** Create mock HealthKit JSON payloads
- **Database Verification:** Query PostgreSQL directly to verify data

### Dashboard Testing
- **Browser Testing:** Manual testing in Safari/Chrome
- **Mock Data:** Test with sample data before iOS integration
- **Responsive Design:** Test on different screen sizes

### Integration Testing
- End-to-end manual testing of full flow
- Monitor logs for errors
- Verify data consistency across components

---

## Monitoring & Logging

### iOS App
- `OSLog` for system logging
- Console output for debugging
- Track sync success/failure rates

### Backend
- Console logging with timestamps
- Log all API requests
- Log database errors
- Consider adding simple request logging middleware

### Database
- PostgreSQL logs for query errors
- Monitor disk usage

### Dashboard
- Browser console for errors
- Network tab for API debugging

---

## Known Limitations (MVP)

1. **Background Sync Reliability:**
   - Not truly hourly - iOS controls timing
   - Requires device to be unlocked
   - May not trigger if device is low battery

2. **Single User Only:**
   - No multi-user support
   - Single API key for all requests

3. **No Offline Dashboard:**
   - Dashboard requires network connection to NAS

4. **Basic Error Handling:**
   - MVP will have minimal error recovery
   - Failed syncs may require manual retry

5. **No Data Validation:**
   - Trust HealthKit data is valid
   - Minimal server-side validation

6. **Mapbox Free Tier:**
   - Limited to 50,000 map loads/month
   - Sufficient for personal use

---

## Success Criteria

MVP is considered successful when:

- ✅ iOS app successfully extracts HealthKit data
- ✅ Background sync works without opening app (even if not strictly hourly)
- ✅ 90-day historical import completes successfully
- ✅ Data is stored correctly in PostgreSQL
- ✅ Dashboard displays last 7 days of workouts
- ✅ GPS routes render correctly on map
- ✅ Activity rings display with accurate data
- ✅ System runs reliably for 1 week without manual intervention
- ✅ Can access dashboard from browser homepage

---

## Next Steps

After reading this architecture plan:

1. Review the detailed database schema (`DATABASE_SCHEMA.md`)
2. Review the API specification (`API_SPECIFICATION.md`)
3. Provide feedback or ask questions
4. Begin Phase 1: Backend Foundation

---

## Questions for Review

Before starting implementation, please confirm:

1. Does this architecture meet your requirements?
2. Any concerns about the technology choices?
3. Should we adjust the MVP feature set?
4. Any questions about deployment to Synology NAS?
5. Ready to proceed with detailed schema and API docs?
