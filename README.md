# Fitness Extractor

A personal fitness data extraction system that syncs HealthKit data from iOS to a PostgreSQL database, with a web dashboard for visualization.

## Project Overview

This system consists of three components:
1. **iOS App** (Swift/SwiftUI) - Extracts HealthKit data with automatic background sync
2. **Backend API** (Node.js/Express/PostgreSQL) - Stores and serves fitness data
3. **Web Dashboard** (React/Vite) - Visualizes activities and GPS routes *(coming soon)*

## Features

- ✅ **Automatic HealthKit Sync**: Background delivery triggers sync when new workouts/metrics are recorded
- ✅ **Full GPS Routes**: Captures complete workout routes with altitude, speed, and accuracy
- ✅ **Historical Import**: Import up to 90 days of past data
- ✅ **Activity Rings**: Daily Move, Exercise, and Stand goals tracking
- ✅ **Health Metrics**: Heart rate, steps, active energy, and more
- ✅ **RESTful API**: Complete API for accessing fitness data
- 🚧 **Web Dashboard**: Coming in Phase 3

## Quick Start

### Prerequisites

- **macOS** with Xcode 15+ (for iOS app development)
- **Docker** (for PostgreSQL database)
- **Node.js** 24.9.0+ with corepack enabled (for backend)
- **pnpm** (auto-installed via corepack)
- **iPhone** with iOS 17+ (HealthKit requires physical device)

### 1. Clone and Setup

```bash
git clone <your-repo-url>
cd fitness-extractor
corepack enable  # enables pnpm via packageManager field
pnpm install     # installs all workspace dependencies
```

### 2. Configure Environment

Create `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and set your values:
```bash
# Database
DB_PASSWORD=your_secure_password_here

# API Key (generate with: openssl rand -base64 32)
API_KEY=your_api_key_here

# Backend
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

### 3. Start PostgreSQL Database

```bash
docker-compose up -d db
```

Verify it's running:
```bash
docker exec fitness-db psql -U postgres -c "SELECT NOW();"
```

### 4. Start Backend Server

```bash
pnpm dev:backend
```

Backend will run on `http://localhost:3000`

### 5. Configure iOS App

1. Open the Xcode project:
   ```bash
   open "ios/HealthKit Sync/HealthKit Sync.xcodeproj"
   ```

2. Create your Config.swift file:
   ```bash
   cd "ios/HealthKit Sync/HealthKit Sync"
   cp Config.example.swift Config.swift
   ```

3. Edit `Config.swift` with your values:
   ```swift
   static let apiBaseURL = "http://YOUR_MAC_IP:3000"  // Find with: ipconfig getifaddr en0
   static let apiKey = "YOUR_API_KEY_HERE"  // From .env file
   ```

4. In Xcode:
   - Connect your iPhone via USB
   - Select your iPhone as the build destination
   - Press ⌘R to build and run

5. Grant HealthKit permissions when prompted

6. Tap "Import Last 90 Days" to import your historical data

## Project Structure

```
fitness-extractor/
├── backend/              # Node.js API server
│   ├── src/
│   │   ├── controllers/  # Request handlers
│   │   ├── services/     # Business logic
│   │   ├── routes/       # API routes
│   │   ├── db/           # Database connection
│   │   └── middleware/   # Auth middleware
│   └── migrations/       # Database migrations
│
├── ios/                  # iOS App (Swift/SwiftUI)
│   └── HealthKit Sync/
│       ├── Config.swift  # API configuration (gitignored)
│       ├── Models.swift  # Data models
│       ├── HealthKitService.swift  # HealthKit extraction
│       ├── SyncService.swift       # Sync orchestration
│       └── APIClient.swift         # Backend API client
│
├── dashboard/            # Web Dashboard (coming soon)
│
└── docs/                 # Documentation
    ├── MVP_ARCHITECTURE.md
    ├── DATABASE_SCHEMA.md
    └── API_SPECIFICATION.md
```

## API Endpoints

### Data Sync (iOS → Backend)
- `POST /api/sync/workouts` - Sync workout data
- `POST /api/sync/health-metrics` - Sync health metrics
- `POST /api/sync/activity-rings` - Sync activity rings
- `POST /api/sync/anchors` - Update sync anchors
- `GET /api/sync/anchors/:userId/:dataType` - Get sync anchor

### Dashboard (Backend → Web)
- `GET /api/dashboard/recent` - Recent workouts and activity
- `GET /api/workout/:id` - Workout details
- `GET /api/workout/:id/route` - GPS route data
- `GET /api/activity-rings/:date` - Activity rings for date
- `GET /api/health-metrics/:metricType` - Health metrics by type

See `docs/API_SPECIFICATION.md` for complete API documentation.

## Database Schema

7 tables:
- **workouts** - Workout sessions with duration, distance, calories, heart rate
- **workout_routes** - GPS route points (JSONB) with bounding boxes
- **health_metrics** - Time-series health data (heart rate, steps, etc.)
- **activity_rings** - Daily Move/Exercise/Stand goals
- **sync_anchors** - HealthKit sync state for incremental updates
- **users** - User accounts
- **schema_migrations** - Migration tracking

See `docs/DATABASE_SCHEMA.md` for complete schema documentation.

## Development Roadmap

- ✅ **Phase 1**: Backend Foundation (Complete)
- ✅ **Phase 2**: iOS App (Complete)
- 🚧 **Phase 3**: Web Dashboard (In Progress)
- ⏳ **Phase 4**: Deployment to Synology NAS via Tailscale
- ⏳ **Phase 5**: Iteration & Polish

See `ROADMAP.md` for detailed progress.

## Git Worktrees

For parallel development:

```bash
# Auto-generate name (e.g., swift_fix_1430)
./scripts/create-worktree.sh

# With custom name
./scripts/create-worktree.sh my-feature

# From specific base branch
./scripts/create-worktree.sh my-feature main
```

Creates worktree at `../fitness-extractor-{name}/` with:
- New branch with same name
- `.env` copied from main repo
- Dependencies installed via pnpm

To remove:
```bash
git worktree remove ../fitness-extractor-{name}
git branch -D {name}
```

Or use Claude Code: `/worktree [name] [base-branch]`

## Testing

### Backend
```bash
pnpm lint         # Check code quality
pnpm build        # Compile TypeScript
```

### Test Data
Sample test files are provided in `backend/`:
- `test-workout.json`
- `test-health-metrics.json`
- `test-activity-rings.json`

```bash
curl -X POST http://localhost:3000/api/sync/workouts \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d @test-workout.json
```

## Deployment

### Local Network
The default setup works on your local network. Your iPhone and backend must be on the same WiFi network.

### Synology NAS (Coming Soon)
Deploy to Synology NAS using Docker Compose and access via Tailscale VPN.

## Troubleshooting

### iOS App
- **"Local network prohibited"**: Grant local network permission in iOS Settings
- **"Authorization not determined"**: Grant HealthKit permissions in iOS Settings → Privacy
- **Sync fails**: Ensure backend is running and iPhone is on same network

### Backend
- **Database connection fails**: Ensure Docker is running (`docker ps`)
- **Port already in use**: Change PORT in `.env` file

### Database
```bash
# Check database status
docker exec fitness-db psql -U postgres -d fitness -c "SELECT NOW();"

# View data counts
docker exec fitness-db psql -U postgres -d fitness -c "
SELECT 'workouts', COUNT(*) FROM workouts
UNION ALL SELECT 'health_metrics', COUNT(*) FROM health_metrics
UNION ALL SELECT 'activity_rings', COUNT(*) FROM activity_rings;
"
```

## Security Notes

- ⚠️ **Never commit** `Config.swift` or `.env` files (they're gitignored)
- 🔑 Generate a strong API key: `openssl rand -base64 32`
- 🔒 Use HTTPS in production (Tailscale provides this automatically)
- 🏠 For personal use only - not designed for multi-user scenarios

## Contributing

This is a personal project, but feel free to fork and adapt for your own use!

## License

MIT License - See LICENSE file for details

## Acknowledgments

Built with Claude Code (https://claude.com/claude-code)
