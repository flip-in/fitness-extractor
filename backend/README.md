# Fitness Extractor - Backend

Node.js backend API server for the Fitness Extractor system.

## Overview

RESTful API that receives HealthKit data from the iOS app and serves data to the web dashboard. Built with Express and PostgreSQL.

## Architecture

**Stack:**
- Node.js with Express
- PostgreSQL 16 (via Docker)
- API key authentication
- RESTful endpoints

**Key Components:**
- `/routes` - API route definitions
- `/controllers` - Request handlers and business logic
- `/services` - Database queries and data operations
- `/middleware` - Authentication, error handling, logging
- `/db` - Database connection pool configuration
- `/config` - Environment configuration
- `/migrations` - SQL migration files for schema changes

## Database

**Connection:**
- Database: `fitness`
- User: `postgres`
- Host: `localhost:5432` (local dev) or `db:5432` (Docker)
- Password: Set in `.env` file

**Schema:**
- 7 tables: users, workouts, workout_routes, health_metrics, activity_rings, sync_anchors, schema_migrations
- 26 indexes for optimized queries
- See `migrations/001_initial_schema.sql` for full schema
- See `/docs/DATABASE_SCHEMA.md` for detailed documentation

## API Endpoints

**iOS Sync Endpoints:**
- `POST /api/sync/workouts` - Upload workout data
- `POST /api/sync/health-metrics` - Upload health metrics
- `POST /api/sync/activity-rings` - Upload activity ring data
- `POST /api/sync/anchors` - Update sync anchor
- `GET /api/sync/anchors/:userId/:dataType` - Get latest sync anchor

**Dashboard Endpoints:**
- `GET /api/dashboard/recent` - Get last 7 days of data
- `GET /api/dashboard/activity-rings` - Get activity rings for date range
- `GET /api/workout/:id` - Get workout details
- `GET /api/workout/:id/route` - Get GPS route data
- `GET /api/health` - Health check endpoint

See `/docs/API_SPECIFICATION.md` for complete API documentation.

## Authentication

API key authentication via `X-API-Key` header.

**Setup:**
1. Generate API key: `openssl rand -base64 32`
2. Add to `.env` file: `API_KEY=your-generated-key`
3. Include in all API requests: `X-API-Key: your-generated-key`

## Development Setup

**Prerequisites:**
- Node.js 18+ (will be configured)
- Docker and Docker Compose
- PostgreSQL container running

**Initial Setup:**

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp ../.env.example ../.env
   # Edit .env with your configuration
   ```

3. Start PostgreSQL (from project root):
   ```bash
   docker compose up -d db
   ```

4. Run migrations (already applied):
   ```bash
   # Migrations are in migrations/ directory
   # First migration (001_initial_schema.sql) already applied
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

## Environment Variables

Required in `.env` file at project root:

```env
# Database
DB_PASSWORD=postgres_dev_password

# API
API_KEY=your-api-key-here

# Server
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

## Database Migrations

**Location:** `migrations/`

**Naming Convention:** `###_description.sql`

**Applied Migrations:**
- `001_initial_schema.sql` - Initial schema with all core tables

**Running Migrations:**
```bash
# From project root
docker exec -i fitness-db psql -U postgres -d fitness < backend/migrations/001_initial_schema.sql
```

**Tracking:**
- Migrations are tracked in `schema_migrations` table
- Each migration records version, description, and timestamp

## Project Structure

```
backend/
├── README.md              # This file
├── package.json           # Node.js dependencies (to be created)
├── src/                   # Source code (to be created)
│   ├── index.js          # Main entry point
│   ├── routes/           # API routes
│   ├── controllers/      # Request handlers
│   ├── services/         # Business logic & DB queries
│   ├── middleware/       # Auth, error handling
│   ├── db/              # Database connection
│   └── config/          # Configuration
└── migrations/           # SQL migrations
    └── 001_initial_schema.sql
```

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (hot reload)
npm run dev

# Start production server
npm start

# Run linter
npm run lint

# Run tests
npm test

# Build for production
npm run build
```

*(Commands will be added when package.json is created)*

## Docker

**Development:**
- Run locally with `npm run dev`
- PostgreSQL in Docker container

**Production:**
- Backend will run in Docker container
- See `docker-compose.yml` for configuration (currently commented out)

## Data Flow

**iOS App → Backend:**
1. iOS app extracts data from HealthKit
2. App sends data to backend via POST endpoints
3. Backend validates API key
4. Backend inserts/updates data in PostgreSQL
5. Backend returns sync anchor for next sync

**Backend → Dashboard:**
1. Dashboard requests data via GET endpoints
2. Backend validates API key
3. Backend queries PostgreSQL
4. Backend returns JSON response
5. Dashboard renders data

## HealthKit Data Deduplication

**Strategy:**
- Each HealthKit object has a unique UUID
- Stored in `healthkit_uuid` column (unique constraint)
- On conflict, skip or update existing record
- Prevents duplicate data from multiple syncs

## Sync Anchors

**Purpose:**
- Track what data has been synced from HealthKit
- Uses HKAnchoredObjectQuery to fetch only new data
- Stored in `sync_anchors` table

**Flow:**
1. iOS app requests latest anchor from backend
2. iOS app queries HealthKit with anchor
3. iOS app uploads new data to backend
4. iOS app uploads new anchor to backend
5. Next sync starts from new anchor

## Common Tasks

**View Database:**
```bash
docker exec -it fitness-db psql -U postgres -d fitness
```

**List Tables:**
```sql
\dt
```

**Check Migration Status:**
```sql
SELECT * FROM schema_migrations;
```

**Test API Endpoint:**
```bash
curl -H "X-API-Key: your-key" http://localhost:3000/api/health
```

## Troubleshooting

**PostgreSQL not running:**
```bash
docker compose up -d db
docker compose logs db
```

**Connection refused:**
- Check PostgreSQL is running: `docker ps`
- Check port 5432 is not in use: `lsof -i :5432`
- Verify `.env` file exists with DB_PASSWORD

**API key errors:**
- Ensure `X-API-Key` header is included in request
- Verify API key matches value in `.env`

## Testing

**Manual Testing:**
Use curl or Postman to test endpoints with sample data.

**Automated Testing:**
Will be added as backend development progresses.

## Performance Considerations

**Database:**
- 26 indexes for common query patterns
- JSONB for flexible GPS route storage
- Connection pooling (to be implemented)

**API:**
- CORS configured for dashboard origin
- Request validation middleware (to be implemented)
- Error logging (to be implemented)

## Security

**Current:**
- API key authentication
- CORS restrictions
- Environment variables for secrets

**Future Improvements:**
- Rate limiting
- Request size limits
- Input sanitization
- HTTPS in production
- JWT tokens for multi-user support

## Related Documentation

- `/docs/MVP_ARCHITECTURE.md` - Overall system architecture
- `/docs/DATABASE_SCHEMA.md` - Complete database schema documentation
- `/docs/API_SPECIFICATION.md` - Full API endpoint specifications
- `/docs/ios-background-sync-research.md` - HealthKit background sync strategy

## Development Status

**Completed:**
- ✅ Database schema designed and implemented
- ✅ PostgreSQL container running
- ✅ Initial migration applied

**In Progress:**
- 🔄 Node.js project setup
- 🔄 API server implementation

**TODO:**
- ⬜ API key authentication middleware
- ⬜ Data ingestion endpoints
- ⬜ Dashboard API endpoints
- ⬜ Error handling and logging
- ⬜ Docker configuration
- ⬜ Testing with mock data

See `ROADMAP.md` for complete project status.
