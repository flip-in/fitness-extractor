-- User-authored data about a workout (favorite now; tags/notes/photos later).
--
-- Kept in its own table, keyed on the HealthKit UUID rather than workouts.id and
-- deliberately WITHOUT a foreign key, so that wiping `workouts` and re-importing
-- from the phone (done once already, 2026-09-08) does not lose anything the user
-- typed or clicked. Join back with workouts.healthkit_uuid.
--
-- Not applied by docker-entrypoint-initdb.d on an existing volume: run by hand
--   docker exec -i fitness-db psql -U postgres -d fitness < 003_workout_annotations.sql

CREATE TABLE IF NOT EXISTS workout_annotations (
    healthkit_uuid VARCHAR(255) PRIMARY KEY,
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    favorited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_annotations_favorite
    ON workout_annotations(healthkit_uuid) WHERE is_favorite;

INSERT INTO schema_migrations (version, description)
VALUES (3, 'workout_annotations: is_favorite')
ON CONFLICT DO NOTHING;
