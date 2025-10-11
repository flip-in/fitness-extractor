# Session Handover - Fitness Extractor Backend

**Date:** 2025-10-11
**Phase:** Phase 1 - Backend Foundation (Data Ingestion Complete)
**Next Task:** Implement Dashboard API endpoints

---

## Current Status

### ✅ Completed
All iOS data ingestion endpoints are fully implemented, tested, and working:
- POST /api/sync/workouts
- POST /api/sync/health-metrics
- POST /api/sync/activity-rings
- POST /api/sync/anchors
- GET /api/sync/anchors/:userId/:dataType

**Milestone M1 achieved:** Backend can receive and store HealthKit data ✅

### 🎯 Next Step
Implement Dashboard API endpoints (5 endpoints) for the React dashboard to read data:
1. GET /api/dashboard/recent - Get last 7 days of workouts
2. GET /api/dashboard/workout/:id - Get single workout details
3. GET /api/dashboard/workout/:id/route - Get GPS route for a workout
4. GET /api/dashboard/activity-rings - Get recent activity rings
5. GET /api/dashboard/stats - Get aggregate statistics

---

## Project Overview

Personal fitness data extraction system with:
1. **iOS App** (Swift/SwiftUI) - Extracts HealthKit data
2. **Backend** (Node.js/Express/PostgreSQL) - Stores and serves data
3. **Web Dashboard** (React/Vite) - Visualizes recent activities

**User:** Personal use, deployed locally via Docker, later to Synology NAS via Tailscale

---

## Technical Stack

- **Backend:** Node.js 24.9.0, TypeScript (strict), Express
- **Database:** PostgreSQL 16 (Docker container: fitness-db)
- **Linting:** Biome v2.1.0 (project-wide config in root)
- **Dev Server:** tsx watch (hot reload)
- **Authentication:** API key via X-API-Key header
- **Environment:** .env in project root (loaded in src/index.ts)

---

## Architecture Decisions

### Environment Variables
- `.env` located at **project root** (not in backend/)
- Loaded in `src/index.ts` using `join(process.cwd(), "../.env")`
- Critical timing issue resolved: load env vars BEFORE any imports that use them

### Database Connection
- **Lazy initialization pattern** in `src/db/pool.ts`
- Export `getPool()` function (not instantiated pool) to ensure env vars loaded first
- Connection details: localhost:5432 (dev), db:5432 (prod)

### Authentication
- API key checked at **runtime** in middleware (not at module load time)
- All `/api/sync/*` routes require API key
- Health check endpoint `/api/health` does NOT require auth

### Code Organization
```
backend/src/
├── index.ts              # Entry point, env loading, Express setup
├── db/
│   └── pool.ts          # Lazy DB connection pool
├── middleware/
│   └── auth.ts          # API key authentication
├── routes/
│   └── sync.ts          # iOS sync routes
├── controllers/
│   └── syncController.ts # Request handlers for sync endpoints
└── services/
    ├── workoutService.ts        # Workout database operations
    ├── healthMetricsService.ts  # Health metrics DB ops
    ├── activityRingsService.ts  # Activity rings DB ops
    └── syncAnchorsService.ts    # Sync anchors DB ops
```

---

## Database Schema

7 tables with 26 indexes:
- `schema_migrations` - Migration tracking
- `users` - User accounts
- `workouts` - Workout records (with healthkit_uuid unique constraint)
- `workout_routes` - GPS route data (JSONB)
- `health_metrics` - Time-series health data
- `activity_rings` - Daily activity summaries (unique on user_id + date)
- `sync_anchors` - HealthKit sync state (unique on user_id + data_type)

**Migration file:** `backend/migrations/001_initial_schema.sql` (already applied)

---

## Key Technical Patterns

### 1. Duplicate Detection
```sql
ON CONFLICT (healthkit_uuid) DO NOTHING  -- workouts, health_metrics
ON CONFLICT (user_id, date) DO UPDATE... -- activity_rings
ON CONFLICT (user_id, data_type) DO UPDATE... -- sync_anchors
```

### 2. Transaction Pattern
```typescript
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // ... operations
  await client.query("COMMIT");
  return { success: true, ... };
} catch (error) {
  await client.query("ROLLBACK");
  return { success: false, error: ... };
} finally {
  client.release();
}
```

### 3. Response Pattern
Controllers return different status codes:
- 200 - All succeeded
- 207 - Partial success (some errors)
- 400 - Bad request (validation failed)
- 404 - Not found (GET endpoints only)
- 500 - All failed / internal error

Response body includes:
```json
{
  "success": true,
  "synced": 5,      // new records
  "skipped": 2,     // duplicates (workouts/metrics only)
  "updated": 3,     // updated records (rings/anchors only)
  "errors": []      // array of errors
}
```

---

## Environment Variables

From `.env` (project root):
```bash
# Database
DB_PASSWORD=postgres_dev_password

# API
API_KEY=NbXmQpGkW3R8v6hrE3Jb3Pg1Mna4gd9TUEuQFMYtR1E=

# Backend
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173

# Dashboard (unused yet)
VITE_API_URL=http://localhost:3000
VITE_MAPBOX_TOKEN=your-mapbox-token-here
```

---

## Running Services

### PostgreSQL
```bash
docker-compose up -d db  # Start database
docker exec fitness-db psql -U postgres -d fitness -c "SELECT NOW();"  # Test
```

### Backend Server
```bash
cd /Users/williamprice/projects/personal/fitness-extractor/backend
npm run dev  # Runs tsx watch, auto-reloads on changes
```

Server runs on port 3000. Background bash process ID: 2b0ab0 (may differ in new session)

---

## Testing Data

Test files in `backend/`:
- `test-workout.json` - Sample workout with metadata
- `test-health-metrics.json` - 3 health metrics
- `test-activity-rings.json` - 2 days of activity data
- `test-activity-rings-update.json` - Update test
- `test-sync-anchors.json` - 3 sync anchors
- `test-sync-anchors-update.json` - Update test

Example test:
```bash
curl -X POST http://localhost:3000/api/sync/workouts \
  -H "Content-Type: application/json" \
  -H "X-API-Key: NbXmQpGkW3R8v6hrE3Jb3Pg1Mna4gd9TUEuQFMYtR1E=" \
  -d @test-workout.json
```

---

## Current Database State

Run this to see all data:
```bash
docker exec fitness-db psql -U postgres -d fitness -c "
SELECT 'workouts' as table_name, COUNT(*) as count FROM workouts
UNION ALL
SELECT 'health_metrics', COUNT(*) FROM health_metrics
UNION ALL
SELECT 'activity_rings', COUNT(*) FROM activity_rings
UNION ALL
SELECT 'sync_anchors', COUNT(*) FROM sync_anchors;
"
```

Expected:
- 1 workout
- 3 health metrics
- 2 activity rings
- 3 sync anchors

---

## Important Notes & Gotchas

### 1. Environment Variable Loading
**Critical:** Must load .env BEFORE importing any modules that use env vars.
The correct pattern is in `src/index.ts`:
```typescript
import { join } from "node:path";
import dotenv from "dotenv";

const envPath = join(process.cwd(), "../.env");
dotenv.config({ path: envPath });

// Validate vars
if (!process.env.DB_PASSWORD || !process.env.API_KEY) {
  console.error("ERROR: Required environment variables not set");
  process.exit(1);
}

// NOW import modules that use env vars
import express from "express";
import { getPool } from "./db/pool.js";
```

### 2. Database Pool
Use `getPool()` function, not direct import:
```typescript
const pool = getPool();  // ✅ Correct
const result = await pool.query(...);
```

### 3. Biome Config
Project-wide Biome config is in **root `biome.json`**, not in backend/
Backend automatically discovers it. Run linting from backend/:
```bash
npm run lint       # Check
npm run lint:fix   # Auto-fix
```

### 4. TypeScript Module System
- `"type": "module"` in package.json
- Use `.js` extensions in imports (even for .ts files)
- `"module": "NodeNext"` in tsconfig.json

### 5. API Specification
Full API spec is in `docs/API_SPECIFICATION.md` - reference this for:
- Request/response schemas
- Status codes
- Error formats
- Query parameters

### 6. Database Schema
Full schema documentation in `docs/DATABASE_SCHEMA.md` - reference for:
- Table structures
- Index strategies
- Sample queries
- Relationships

---

## Next Steps (Dashboard API Implementation)

### 1. Create Dashboard Routes
File: `backend/src/routes/dashboard.ts`
```typescript
import express from "express";
import { requireApiKey } from "../middleware/auth.js";

const router = express.Router();
router.use(requireApiKey);  // Dashboard endpoints also require auth

router.get("/recent", getRecentWorkouts);
router.get("/workout/:id", getWorkoutDetails);
router.get("/workout/:id/route", getWorkoutRoute);
router.get("/activity-rings", getActivityRings);
router.get("/stats", getStats);

export default router;
```

### 2. Create Dashboard Service
File: `backend/src/services/dashboardService.ts`
- `getRecentWorkouts(pool, userId, days)` - Last N days of workouts
- `getWorkoutById(pool, workoutId)` - Single workout with details
- `getWorkoutRoute(pool, workoutId)` - GPS route data
- `getActivityRings(pool, userId, days)` - Recent activity rings
- `getAggregateStats(pool, userId)` - Calculate totals/averages

### 3. Create Dashboard Controller
File: `backend/src/controllers/dashboardController.ts`
- Handle request validation
- Call service functions
- Format responses
- Handle errors (404 for not found, etc.)

### 4. Wire Up Routes
In `backend/src/index.ts`:
```typescript
import dashboardRoutes from "./routes/dashboard.js";
app.use("/api/dashboard", dashboardRoutes);
```

### 5. Test Each Endpoint
Create test scripts or use curl to verify:
- Correct data returned
- Proper filtering (date ranges, user_id)
- 404 handling for missing resources
- Performance with indexes

### 6. Update Documentation
- Mark dashboard endpoints as complete in ROADMAP.md
- Add implementation notes
- Document any decisions made

---

## Reference Documents

All in `docs/`:
- `MVP_ARCHITECTURE.md` - Overall system architecture
- `DATABASE_SCHEMA.md` - Complete database schema with examples
- `API_SPECIFICATION.md` - All 11 API endpoints fully specified
- `ios-background-sync-research.md` - iOS HealthKit background sync strategy

---

## Development Commands

```bash
# Backend
npm run dev        # Start dev server with hot reload
npm run build      # Compile TypeScript
npm run start      # Run compiled JS
npm run lint       # Check code
npm run lint:fix   # Auto-fix issues
npm run format     # Format code

# Database
docker-compose up -d db                    # Start PostgreSQL
docker-compose down                         # Stop all services
docker exec fitness-db psql -U postgres -d fitness  # Connect to DB
```

---

## Common Queries

```sql
-- Check all workouts
SELECT id, workout_type, start_date, duration_seconds
FROM workouts ORDER BY start_date DESC;

-- Check if workout has route
SELECT w.id, w.workout_type,
       wr.total_points, wr.min_latitude, wr.max_latitude
FROM workouts w
LEFT JOIN workout_routes wr ON w.id = wr.workout_id;

-- Recent health metrics
SELECT metric_type, value, unit, start_date
FROM health_metrics
ORDER BY start_date DESC LIMIT 10;

-- Activity rings
SELECT date, move_percent, exercise_percent, stand_percent
FROM activity_rings
ORDER BY date DESC;
```

---

## Questions to Ask User (If Needed)

1. **Dashboard authentication:** Should dashboard endpoints require API key, or should they be public (since accessing via Tailscale)?
2. **Default date range:** How many days should "recent" mean? (Currently 7 in spec)
3. **Pagination:** Should workout lists be paginated, or is limiting to recent days sufficient?
4. **Stats calculation:** Which aggregate stats are most important? (total workouts, total distance, average heart rate, etc.)

---

## Troubleshooting

### Server won't start
- Check .env exists at project root
- Verify DB_PASSWORD and API_KEY are set
- Check PostgreSQL is running: `docker ps`

### Database connection fails
- Ensure container is running: `docker-compose up -d db`
- Check connection: `docker exec fitness-db psql -U postgres -c "SELECT 1;"`
- Verify DB_PASSWORD matches between .env and docker-compose.yml

### Linting errors
- Run from backend/: `npm run lint:fix`
- Check biome.json exists in project root
- Verify imports are sorted alphabetically

### TypeScript errors
- Check all imports end with `.js`
- Verify tsconfig.json has `"module": "NodeNext"`
- Run `npm run build` to see full error details

---

## Success Criteria for Next Phase

Dashboard API endpoints are complete when:
- ✅ All 5 endpoints implemented and tested
- ✅ Proper error handling (404, 500)
- ✅ Date filtering works correctly
- ✅ GPS route data formatted for Mapbox
- ✅ All code passes linting
- ✅ ROADMAP.md updated
- ✅ Ready for React dashboard implementation

---

## Final Notes

- User prefers concise updates, not verbose explanations
- Update ROADMAP.md after each major task (per .claude/CLAUDE.md)
- Use TodoWrite tool to track multi-step tasks
- Run linter before completing work
- Keep things simple - avoid over-engineering

**Good luck! 🚀**
