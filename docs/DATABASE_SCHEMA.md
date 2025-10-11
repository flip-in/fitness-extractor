# Database Schema - Fitness Extractor

## Overview

PostgreSQL database schema optimized for storing time-series fitness data from HealthKit.

**Design Principles:**
- Normalize where it makes sense, denormalize for performance
- Index on common query patterns
- Use timestamps with timezone for all time data
- Store GPS data as JSON for flexibility
- Use UUIDs from HealthKit for deduplication

---

## Schema Diagram

```
┌─────────────┐
│   users     │
└──────┬──────┘
       │
       │ 1:N
       ├─────────────┬──────────────┬────────────────┬───────────────┐
       │             │              │                │               │
       ▼             ▼              ▼                ▼               ▼
┌─────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────┐ ┌───────────────┐
│  workouts   │ │health_metrics│ │activity_rings│ │sync_anchors│ │nutrition_logs │
└──────┬──────┘ └──────────────┘ └────────────┘ └──────────────┘ └───────────────┘
       │                                                             (future)
       │ 1:N
       ▼
┌─────────────────┐
│ workout_routes  │
│  (GPS points)   │
└─────────────────┘
```

---

## Tables

### `users`

Stores user information. MVP has single user, but schema supports multiple for future.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```

**Fields:**
- `id` - Primary key, auto-generated UUID
- `email` - User email (optional for MVP, unique if set)
- `name` - Display name
- `created_at` - Account creation timestamp
- `updated_at` - Last update timestamp

**MVP Note:** Single user will be created during initial setup.

---

### `workouts`

Stores individual workout sessions from HealthKit.

```sql
CREATE TABLE workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    healthkit_uuid VARCHAR(255) UNIQUE NOT NULL,
    workout_type VARCHAR(100) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER NOT NULL,

    -- Metrics
    total_distance_meters DECIMAL(10, 2),
    total_energy_burned_kcal DECIMAL(10, 2),
    avg_heart_rate_bpm INTEGER,
    max_heart_rate_bpm INTEGER,

    -- Additional data
    source_name VARCHAR(255),
    source_bundle_id VARCHAR(255),
    device_name VARCHAR(255),

    -- Metadata stored as JSONB for flexibility
    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_workouts_user_id ON workouts(user_id);
CREATE INDEX idx_workouts_start_date ON workouts(start_date DESC);
CREATE INDEX idx_workouts_user_start ON workouts(user_id, start_date DESC);
CREATE INDEX idx_workouts_type ON workouts(workout_type);
CREATE UNIQUE INDEX idx_workouts_healthkit_uuid ON workouts(healthkit_uuid);
```

**Fields:**
- `id` - Primary key, auto-generated UUID
- `user_id` - Foreign key to users table
- `healthkit_uuid` - HealthKit's unique identifier (for deduplication)
- `workout_type` - Type of workout (e.g., "Running", "Cycling", "Swimming")
- `start_date` - Workout start time
- `end_date` - Workout end time
- `duration_seconds` - Total duration in seconds
- `total_distance_meters` - Distance covered (if applicable)
- `total_energy_burned_kcal` - Calories burned
- `avg_heart_rate_bpm` - Average heart rate
- `max_heart_rate_bpm` - Maximum heart rate
- `source_name` - App/device that recorded workout (e.g., "Apple Watch")
- `source_bundle_id` - Bundle identifier of source app
- `device_name` - Device name (e.g., "iPhone 15 Pro")
- `metadata` - Additional data stored as JSON (flexible for future)
- `created_at` - Record creation timestamp
- `updated_at` - Last update timestamp

**HealthKit Workout Types (Common):**
- Running, Walking, Cycling, Swimming
- FunctionalStrengthTraining, TraditionalStrengthTraining
- Hiking, Yoga, Dance, Rowing
- HighIntensityIntervalTraining
- [Full list in Apple HealthKit docs]

---

### `workout_routes`

Stores GPS coordinates for workouts with route data.

```sql
CREATE TABLE workout_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,

    -- Store as JSONB array for flexibility
    -- Format: [{"lat": 37.7749, "lon": -122.4194, "timestamp": "2025-01-15T10:30:00Z", "altitude": 10.5}, ...]
    route_points JSONB NOT NULL,

    -- Summary statistics
    total_points INTEGER NOT NULL,
    min_latitude DECIMAL(10, 7),
    max_latitude DECIMAL(10, 7),
    min_longitude DECIMAL(10, 7),
    max_longitude DECIMAL(10, 7),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workout_routes_workout_id ON workout_routes(workout_id);
```

**Fields:**
- `id` - Primary key
- `workout_id` - Foreign key to workouts
- `route_points` - JSONB array of GPS points with timestamps
- `total_points` - Number of GPS points in route
- `min_latitude`, `max_latitude` - Bounding box for quick lookups
- `min_longitude`, `max_longitude` - Bounding box for quick lookups
- `created_at` - Record creation timestamp

**Route Point Format (JSONB):**
```json
[
  {
    "lat": 37.7749,
    "lon": -122.4194,
    "timestamp": "2025-01-15T10:30:00Z",
    "altitude": 10.5,
    "speed": 2.5,
    "horizontal_accuracy": 5.0
  },
  ...
]
```

**Why JSONB?**
- Flexible for different GPS point formats
- Efficient storage and querying
- Can index specific fields if needed
- Easy to serialize to frontend

---

### `health_metrics`

Stores time-series health data points (heart rate, steps, etc.).

```sql
CREATE TABLE health_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    healthkit_uuid VARCHAR(255) UNIQUE NOT NULL,

    metric_type VARCHAR(100) NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50) NOT NULL,

    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,

    source_name VARCHAR(255),
    source_bundle_id VARCHAR(255),
    device_name VARCHAR(255),

    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for time-series queries
CREATE INDEX idx_health_metrics_user_id ON health_metrics(user_id);
CREATE INDEX idx_health_metrics_type_date ON health_metrics(metric_type, start_date DESC);
CREATE INDEX idx_health_metrics_user_type_date ON health_metrics(user_id, metric_type, start_date DESC);
CREATE UNIQUE INDEX idx_health_metrics_healthkit_uuid ON health_metrics(healthkit_uuid);
```

**Fields:**
- `id` - Primary key
- `user_id` - Foreign key to users
- `healthkit_uuid` - HealthKit's unique identifier (for deduplication)
- `metric_type` - Type of metric (see below)
- `value` - Numeric value
- `unit` - Unit of measurement (e.g., "bpm", "steps", "km")
- `start_date` - Start of measurement period
- `end_date` - End of measurement period
- `source_name` - Source app/device
- `source_bundle_id` - Bundle identifier
- `device_name` - Device name
- `metadata` - Additional data as JSON
- `created_at` - Record creation timestamp

**Common Metric Types:**
- `heartRate` - Heart rate (bpm)
- `stepCount` - Steps taken (count)
- `distanceWalkingRunning` - Distance (meters)
- `activeEnergyBurned` - Active calories (kcal)
- `basalEnergyBurned` - Resting calories (kcal)
- `restingHeartRate` - Resting heart rate (bpm)
- `heartRateVariability` - HRV (ms)
- `vo2Max` - VO2 max (ml/kg/min)
- `bodyMass` - Weight (kg)
- `height` - Height (cm)
- `sleepAnalysis` - Sleep data (minutes)

---

### `activity_rings`

Stores daily activity ring data (Move, Exercise, Stand).

```sql
CREATE TABLE activity_rings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    date DATE NOT NULL,

    -- Move ring (active calories)
    move_goal_kcal INTEGER NOT NULL,
    move_actual_kcal INTEGER NOT NULL,
    move_percent DECIMAL(5, 2) NOT NULL,

    -- Exercise ring (minutes)
    exercise_goal_minutes INTEGER NOT NULL,
    exercise_actual_minutes INTEGER NOT NULL,
    exercise_percent DECIMAL(5, 2) NOT NULL,

    -- Stand ring (hours)
    stand_goal_hours INTEGER NOT NULL,
    stand_actual_hours INTEGER NOT NULL,
    stand_percent DECIMAL(5, 2) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, date)
);

CREATE INDEX idx_activity_rings_user_date ON activity_rings(user_id, date DESC);
CREATE INDEX idx_activity_rings_date ON activity_rings(date DESC);
```

**Fields:**
- `id` - Primary key
- `user_id` - Foreign key to users
- `date` - Date (not timestamp, one record per day)
- `move_goal_kcal` - Daily move goal
- `move_actual_kcal` - Actual move calories
- `move_percent` - Percentage of goal achieved
- `exercise_goal_minutes` - Daily exercise goal (typically 30 min)
- `exercise_actual_minutes` - Actual exercise minutes
- `exercise_percent` - Percentage of goal achieved
- `stand_goal_hours` - Daily stand goal (typically 12 hours)
- `stand_actual_hours` - Actual stand hours
- `stand_percent` - Percentage of goal achieved
- `created_at` - Record creation timestamp
- `updated_at` - Last update (ring can update throughout day)

**Unique Constraint:** One record per user per day. Updates replace values.

---

### `sync_anchors`

Stores HealthKit sync anchors to track what data has been synced.

```sql
CREATE TABLE sync_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    data_type VARCHAR(100) NOT NULL,
    anchor_data TEXT NOT NULL,

    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, data_type)
);

CREATE INDEX idx_sync_anchors_user_type ON sync_anchors(user_id, data_type);
```

**Fields:**
- `id` - Primary key
- `user_id` - Foreign key to users
- `data_type` - Type of data (e.g., "workouts", "heartRate", "activitySummary")
- `anchor_data` - Serialized anchor from HealthKit (Base64 encoded)
- `last_sync_at` - Timestamp of last successful sync

**Purpose:**
- HKAnchoredObjectQuery uses anchors to fetch only new data
- Prevents re-syncing already uploaded data
- Each data type has its own anchor

**Data Types:**
- `workouts` - All workouts
- `heartRate` - Heart rate samples
- `stepCount` - Step count samples
- `activitySummary` - Daily activity rings
- `distanceWalkingRunning` - Distance samples
- (Add more as needed)

---

### `nutrition_logs` (Future - Out of MVP Scope)

Placeholder for future nutrition tracking feature.

```sql
-- Future table - not implemented in MVP
CREATE TABLE nutrition_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    logged_at TIMESTAMPTZ NOT NULL,
    meal_type VARCHAR(50), -- breakfast, lunch, dinner, snack

    food_name VARCHAR(255) NOT NULL,
    brand_name VARCHAR(255),

    -- Macros
    calories_kcal DECIMAL(10, 2),
    protein_g DECIMAL(10, 2),
    carbs_g DECIMAL(10, 2),
    fat_g DECIMAL(10, 2),
    fiber_g DECIMAL(10, 2),

    -- Serving
    serving_size DECIMAL(10, 2),
    serving_unit VARCHAR(50),

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nutrition_logs_user_date ON nutrition_logs(user_id, logged_at DESC);
```

---

## Initial Data Migration

### Create User (Run Once)

```sql
INSERT INTO users (id, name, email, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'William Price',
    'will@example.com',
    NOW(),
    NOW()
);
```

**Note:** Save the generated UUID - you'll need it for API configuration.

---

## Common Queries

### Get Last 7 Days of Workouts

```sql
SELECT
    w.*,
    wr.route_points,
    wr.total_points as route_point_count
FROM workouts w
LEFT JOIN workout_routes wr ON w.id = wr.workout_id
WHERE w.user_id = $1
    AND w.start_date >= NOW() - INTERVAL '7 days'
ORDER BY w.start_date DESC;
```

### Get Activity Rings for Date Range

```sql
SELECT *
FROM activity_rings
WHERE user_id = $1
    AND date >= $2
    AND date <= $3
ORDER BY date DESC;
```

### Get Health Metrics by Type

```sql
SELECT *
FROM health_metrics
WHERE user_id = $1
    AND metric_type = $2
    AND start_date >= $3
    AND start_date <= $4
ORDER BY start_date ASC;
```

### Get Latest Sync Anchor

```sql
SELECT anchor_data, last_sync_at
FROM sync_anchors
WHERE user_id = $1
    AND data_type = $2;
```

### Check for Duplicate Before Insert

```sql
SELECT id
FROM workouts
WHERE healthkit_uuid = $1;
```

---

## Data Retention Policy (Future)

For MVP, keep all data indefinitely. Consider adding:

- Archive old data (> 1 year) to separate table
- Aggregate older data (daily/weekly summaries)
- Configurable retention period

---

## Performance Considerations

### Indexes
All common query patterns are indexed:
- User-based queries
- Date range queries
- Workout type filtering
- HealthKit UUID lookups (for deduplication)

### Time-Series Optimization
Consider adding TimescaleDB extension post-MVP:
```sql
-- Future: Convert to hypertable
SELECT create_hypertable('health_metrics', 'start_date');
SELECT create_hypertable('workouts', 'start_date');
```

### JSONB Performance
- Route points stored as JSONB for flexibility
- Can add GIN indexes if needed:
```sql
CREATE INDEX idx_workout_routes_points ON workout_routes USING GIN (route_points);
```

---

## Backup Strategy

### Automated Backups
Use `pg_dump` for daily backups:
```bash
pg_dump -U postgres -d fitness -F c -f backup_$(date +%Y%m%d).dump
```

### What to Backup
- Full database dump daily
- Keep 7 daily backups
- Keep 4 weekly backups
- Keep 12 monthly backups

### Synology NAS Integration
- Store backups in separate directory on NAS
- Use Synology's Hyper Backup for redundancy

---

## Schema Versioning

### Migration Strategy
Use a simple migration system:

1. Create `migrations/` directory
2. Name files: `001_initial_schema.sql`, `002_add_nutrition.sql`
3. Track applied migrations in database:

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    description VARCHAR(255),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Initial Migration (001_initial_schema.sql)
Contains all tables defined in this document.

---

## Testing Data

### Sample Workout Insert

```sql
INSERT INTO workouts (
    user_id,
    healthkit_uuid,
    workout_type,
    start_date,
    end_date,
    duration_seconds,
    total_distance_meters,
    total_energy_burned_kcal,
    avg_heart_rate_bpm,
    max_heart_rate_bpm,
    source_name,
    device_name
) VALUES (
    '00000000-0000-0000-0000-000000000001', -- Replace with your user_id
    'HK-WORKOUT-UUID-12345',
    'Running',
    '2025-01-15 08:00:00-08',
    '2025-01-15 08:35:00-08',
    2100,
    5000.0,
    350.0,
    145,
    165,
    'Apple Watch',
    'Apple Watch Series 9'
);
```

### Sample Activity Ring Insert

```sql
INSERT INTO activity_rings (
    user_id,
    date,
    move_goal_kcal,
    move_actual_kcal,
    move_percent,
    exercise_goal_minutes,
    exercise_actual_minutes,
    exercise_percent,
    stand_goal_hours,
    stand_actual_hours,
    stand_percent
) VALUES (
    '00000000-0000-0000-0000-000000000001', -- Replace with your user_id
    '2025-01-15',
    600,
    725,
    120.83,
    30,
    42,
    140.00,
    12,
    11,
    91.67
);
```

---

## Schema Evolution Notes

### Adding New Columns
- Always use `ALTER TABLE` for schema changes
- Add columns as `NULL` first, then backfill
- Add `NOT NULL` constraint after backfill

### Adding New Tables
- Follow naming conventions
- Always include `created_at` timestamp
- Consider `updated_at` for mutable data
- Use UUIDs for primary keys
- Add indexes for foreign keys

### HealthKit Data Expansion
Schema is flexible for adding new HealthKit data types:
1. Add to `health_metrics` if it's a time-series value
2. Create new table if it has complex structure
3. Update `sync_anchors` to track new data type

---

## Summary

This schema provides:
- ✅ All MVP data storage requirements
- ✅ Efficient querying for common patterns
- ✅ Deduplication via HealthKit UUIDs
- ✅ Flexible JSON storage for complex data
- ✅ Time-series optimized indexes
- ✅ Future extensibility
- ✅ Single user with multi-user support ready

Next: Review API Specification (`API_SPECIFICATION.md`)
