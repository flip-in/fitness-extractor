-- Migration: 001_initial_schema.sql
-- Description: Initial database schema with all core tables for fitness data extraction
-- Date: 2025-10-11

-- Create schema migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- Workouts table
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

-- Workout routes table (GPS data)
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

-- Health metrics table (time-series data)
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

-- Activity rings table (daily summaries)
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

-- Sync anchors table (track HealthKit sync state)
CREATE TABLE sync_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    data_type VARCHAR(100) NOT NULL,
    anchor_data TEXT NOT NULL,

    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, data_type)
);

CREATE INDEX idx_sync_anchors_user_type ON sync_anchors(user_id, data_type);

-- Record this migration
INSERT INTO schema_migrations (version, description, applied_at)
VALUES (1, 'Initial schema with users, workouts, health_metrics, activity_rings, sync_anchors', NOW());
