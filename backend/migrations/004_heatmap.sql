-- GPS heatmap as grid counts (decided 2026-09-10; docs/heatmap-feature/research.md).
--
-- Every workout route is rasterised once into Web Mercator tile-pixel cells
-- (256px tiles) at zoom 13 (~19 m at the equator, ~12 m at 52°N) plus coarser
-- rollups at zoom 10 and 7 for wide views. `count` is the number of activities
-- that passed through the cell (deduped within one activity, so a GPS stall at
-- a traffic light does not glow). Rows are keyed on the raw HealthKit workout
-- type; grouping into cycling / running / walking / other is the dashboard's job.
--
-- heatmap_rasterized records which workouts are already counted, so a rebuild
-- can be resumed and the sync path can skip a route it has seen. Both tables are
-- derived data: TRUNCATE + POST /api/heatmap/rebuild recreates them from
-- workout_routes.

CREATE TABLE IF NOT EXISTS heatmap_cells (
    zoom SMALLINT NOT NULL,
    workout_type VARCHAR(100) NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (zoom, workout_type, x, y)
);

-- Viewport queries filter on zoom + x range + y range across all types.
CREATE INDEX IF NOT EXISTS idx_heatmap_cells_zoom_xy ON heatmap_cells(zoom, x, y);

CREATE TABLE IF NOT EXISTS heatmap_rasterized (
    workout_id UUID PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE,
    rasterized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, description)
VALUES (4, 'heatmap_cells grid counts + heatmap_rasterized')
ON CONFLICT DO NOTHING;
