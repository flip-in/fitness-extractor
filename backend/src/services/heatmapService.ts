import type { Pool, PoolClient } from "pg";

/**
 * GPS heatmap as grid counts. See migrations/004_heatmap.sql for the model.
 *
 * Rasterising a route: project every point to integer Web Mercator tile-pixel
 * coordinates at BASE_ZOOM, walk each consecutive pair with Bresenham so every
 * cell the segment crosses is hit, dedupe within the activity, then +1 each
 * cell. Coarser zooms are the same set shifted right (2^(13-z) cells per side)
 * and deduped again, so `count` at every zoom is "activities through this cell".
 */

export const BASE_ZOOM = 13;
export const ZOOMS = [13, 10, 7] as const;
const TILE = 256;
/** A segment longer than this many base cells (~40 km) is a GPS glitch, not a ride. */
const MAX_SEGMENT_CELLS = 2000;
/** Points less accurate than this (metres) are dropped before rasterising. */
const MAX_HORIZONTAL_ACCURACY_M = 100;
const MAX_LAT = 85.05112878;

export interface RoutePointInput {
	lat: number;
	lon: number;
	horizontal_accuracy?: number | null;
}

/** Fractional tile-pixel coordinates of a lon/lat at `zoom` (256px tiles). */
export function project(
	lon: number,
	lat: number,
	zoom: number,
): { x: number; y: number } {
	const n = TILE * 2 ** zoom;
	const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
	const latR = (clampedLat * Math.PI) / 180;
	const x = ((lon + 180) / 360) * n;
	const y =
		((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
	return { x, y };
}

/** Cells at BASE_ZOOM as packed numbers (x * 2^22 + y; both < 2^21). */
const PACK = 2 ** 22;
const pack = (x: number, y: number) => x * PACK + y;
const unpack = (key: number) => ({ x: Math.floor(key / PACK), y: key % PACK });

function bresenham(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	out: Set<number>,
): void {
	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;
	let x = x0;
	let y = y0;
	for (;;) {
		out.add(pack(x, y));
		if (x === x1 && y === y1) return;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y += sy;
		}
	}
}

/** Distinct BASE_ZOOM cells a route passes through. */
export function rasterizeRoute(points: RoutePointInput[]): Set<number> {
	const cells = new Set<number>();
	let prev: { x: number; y: number } | null = null;
	for (const p of points) {
		if (
			p.horizontal_accuracy != null &&
			p.horizontal_accuracy > MAX_HORIZONTAL_ACCURACY_M
		) {
			continue;
		}
		if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
		const { x, y } = project(p.lon, p.lat, BASE_ZOOM);
		const cur = { x: Math.floor(x), y: Math.floor(y) };
		if (prev) {
			const span = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
			if (span <= MAX_SEGMENT_CELLS) {
				bresenham(prev.x, prev.y, cur.x, cur.y, cells);
			} else {
				cells.add(pack(cur.x, cur.y));
			}
		} else {
			cells.add(pack(cur.x, cur.y));
		}
		prev = cur;
	}
	return cells;
}

/** The same cell set at a coarser zoom, deduped. */
function rollup(
	baseCells: Set<number>,
	zoom: number,
): { xs: number[]; ys: number[] } {
	const shift = BASE_ZOOM - zoom;
	const seen = new Set<number>();
	const xs: number[] = [];
	const ys: number[] = [];
	for (const key of baseCells) {
		const { x, y } = unpack(key);
		const cx = x >> shift;
		const cy = y >> shift;
		const ck = pack(cx, cy);
		if (seen.has(ck)) continue;
		seen.add(ck);
		xs.push(cx);
		ys.push(cy);
	}
	return { xs, ys };
}

async function upsertCells(
	client: PoolClient,
	workoutId: string,
	workoutType: string,
	baseCells: Set<number>,
): Promise<void> {
	for (const zoom of ZOOMS) {
		const { xs, ys } = rollup(baseCells, zoom);
		if (xs.length === 0) continue;
		await client.query(
			`INSERT INTO heatmap_cells (zoom, workout_type, x, y, count)
			 SELECT $1, $2, unnest($3::int[]), unnest($4::int[]), 1
			 ON CONFLICT (zoom, workout_type, x, y)
			 DO UPDATE SET count = heatmap_cells.count + 1`,
			[zoom, workoutType, xs, ys],
		);
	}
	await client.query(
		"INSERT INTO heatmap_rasterized (workout_id) VALUES ($1)",
		[workoutId],
	);
}

/**
 * Count one workout's route into the heatmap. Idempotent: a workout already in
 * heatmap_rasterized is skipped, so the sync path can call this on every route
 * it stores. Returns the number of base cells added (0 when skipped).
 */
export async function rasterizeWorkout(
	pool: Pool,
	workoutId: string,
	workoutType: string,
	points: RoutePointInput[],
): Promise<number> {
	const cells = rasterizeRoute(points);
	if (cells.size === 0) return 0;
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		// The row lock serialises two concurrent rasterisations of one workout.
		const seen = await client.query(
			"SELECT 1 FROM heatmap_rasterized WHERE workout_id = $1 FOR UPDATE",
			[workoutId],
		);
		if (seen.rows.length > 0) {
			await client.query("ROLLBACK");
			return 0;
		}
		await upsertCells(client, workoutId, workoutType, cells);
		await client.query("COMMIT");
		return cells.size;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

// MARK: - Rebuild

export interface RebuildState {
	running: boolean;
	total: number;
	done: number;
	started_at: string | null;
	finished_at: string | null;
	error: string | null;
}

const rebuildState: RebuildState = {
	running: false,
	total: 0,
	done: 0,
	started_at: null,
	finished_at: null,
	error: null,
};

export function getRebuildState(): RebuildState {
	return { ...rebuildState };
}

/**
 * Drop and recount everything from workout_routes, one route in memory at a
 * time. Returns false if a rebuild is already running. Runs to completion in
 * the background; poll getRebuildState().
 */
export function startRebuild(pool: Pool): boolean {
	if (rebuildState.running) return false;
	rebuildState.running = true;
	rebuildState.total = 0;
	rebuildState.done = 0;
	rebuildState.started_at = new Date().toISOString();
	rebuildState.finished_at = null;
	rebuildState.error = null;

	void (async () => {
		try {
			await pool.query("TRUNCATE heatmap_cells, heatmap_rasterized");
			const ids = await pool.query<{ id: string; workout_type: string }>(
				`SELECT w.id, w.workout_type
				 FROM workouts w JOIN workout_routes r ON r.workout_id = w.id
				 ORDER BY w.start_date`,
			);
			rebuildState.total = ids.rows.length;
			for (const row of ids.rows) {
				const route = await pool.query<{ route_points: RoutePointInput[] }>(
					"SELECT route_points FROM workout_routes WHERE workout_id = $1",
					[row.id],
				);
				const points = route.rows[0]?.route_points ?? [];
				await rasterizeWorkout(pool, row.id, row.workout_type, points);
				rebuildState.done += 1;
			}
			console.log(`Heatmap rebuilt: ${rebuildState.done} routes`);
		} catch (error) {
			rebuildState.error =
				error instanceof Error ? error.message : String(error);
			console.error("Heatmap rebuild failed:", error);
		} finally {
			rebuildState.running = false;
			rebuildState.finished_at = new Date().toISOString();
		}
	})();
	return true;
}

// MARK: - Queries

export interface CellsResponse {
	zoom: number;
	/** Per workout type, flat triples [x, y, count, x, y, count, ...]. */
	cells: Record<string, number[]>;
	truncated: boolean;
}

const MAX_CELLS = 80_000;

/**
 * Cells at `zoom` inside the lon/lat bbox [west, south, east, north].
 * Flat arrays keep the JSON small; the client turns cells back into lon/lat.
 */
export async function getCells(
	pool: Pool,
	zoom: number,
	bbox: [number, number, number, number],
	types: string[] | null,
): Promise<CellsResponse> {
	const [west, south, east, north] = bbox;
	const nw = project(Math.max(-180, west), Math.min(MAX_LAT, north), zoom);
	const se = project(Math.min(180, east), Math.max(-MAX_LAT, south), zoom);
	const params: unknown[] = [
		zoom,
		Math.floor(nw.x),
		Math.floor(se.x),
		Math.floor(nw.y),
		Math.floor(se.y),
	];
	let typeFilter = "";
	if (types && types.length > 0) {
		params.push(types);
		typeFilter = `AND workout_type = ANY($${params.length}::text[])`;
	}
	params.push(MAX_CELLS + 1);
	const result = await pool.query<{
		workout_type: string;
		x: number;
		y: number;
		count: number;
	}>(
		`SELECT workout_type, x, y, count
		 FROM heatmap_cells
		 WHERE zoom = $1 AND x BETWEEN $2 AND $3 AND y BETWEEN $4 AND $5 ${typeFilter}
		 LIMIT $${params.length}`,
		params,
	);
	const truncated = result.rows.length > MAX_CELLS;
	const cells: Record<string, number[]> = {};
	for (const row of result.rows.slice(0, MAX_CELLS)) {
		let flat = cells[row.workout_type];
		if (!flat) {
			flat = [];
			cells[row.workout_type] = flat;
		}
		flat.push(row.x, row.y, row.count);
	}
	return { zoom, cells, truncated };
}

export interface HeatmapWorkout {
	id: string;
	workout_type: string;
	start_date: string;
	duration_seconds: number;
	total_distance_meters: number | null;
	is_favorite: boolean;
	bounds: {
		min_lat: number;
		max_lat: number;
		min_lon: number;
		max_lon: number;
	};
}

/** Every workout that has a route, newest first, with its bounding box. */
export async function listWorkoutsWithRoutes(
	pool: Pool,
	userId: string,
): Promise<HeatmapWorkout[]> {
	const result = await pool.query(
		`SELECT w.id, w.workout_type, w.start_date, w.duration_seconds,
		        w.total_distance_meters,
		        COALESCE(a.is_favorite, false) AS is_favorite,
		        r.min_latitude, r.max_latitude, r.min_longitude, r.max_longitude
		 FROM workouts w
		 JOIN workout_routes r ON r.workout_id = w.id
		 LEFT JOIN workout_annotations a ON a.healthkit_uuid = w.healthkit_uuid
		 WHERE w.user_id = $1
		 ORDER BY w.start_date DESC`,
		[userId],
	);
	return result.rows.map((row) => ({
		id: row.id,
		workout_type: row.workout_type,
		start_date: row.start_date,
		duration_seconds: row.duration_seconds,
		total_distance_meters:
			row.total_distance_meters == null
				? null
				: Number(row.total_distance_meters),
		is_favorite: row.is_favorite,
		bounds: {
			min_lat: Number(row.min_latitude),
			max_lat: Number(row.max_latitude),
			min_lon: Number(row.min_longitude),
			max_lon: Number(row.max_longitude),
		},
	}));
}

export interface HeatmapStatus {
	cells_by_zoom: Record<string, number>;
	rasterized_workouts: number;
	routes: number;
	rebuild: RebuildState;
}

export async function getStatus(pool: Pool): Promise<HeatmapStatus> {
	const cells = await pool.query<{ zoom: number; n: string }>(
		"SELECT zoom, count(*) AS n FROM heatmap_cells GROUP BY zoom ORDER BY zoom",
	);
	const counts = await pool.query<{ rasterized: string; routes: string }>(
		`SELECT (SELECT count(*) FROM heatmap_rasterized) AS rasterized,
		        (SELECT count(*) FROM workout_routes) AS routes`,
	);
	const byZoom: Record<string, number> = {};
	for (const row of cells.rows) byZoom[String(row.zoom)] = Number(row.n);
	return {
		cells_by_zoom: byZoom,
		rasterized_workouts: Number(counts.rows[0].rasterized),
		routes: Number(counts.rows[0].routes),
		rebuild: getRebuildState(),
	};
}
