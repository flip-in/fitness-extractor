import type { Pool, PoolClient } from "pg";
import { fromGeojsonVt } from "vt-pbf";
import { type ActivityGroup, groupCaseSql, groupOf } from "./heatmapGroups.js";

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
/** Routes with more points than this are recorded as rasterised but not counted (CPU guard). */
const MAX_ROUTE_POINTS = 100_000;
/** pg_advisory_xact_lock key shared by rasterisation and the rebuild's TRUNCATE. */
const HEATMAP_LOCK_KEY = 0x48454154;
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
 * it stores. A route that yields no cells (or is over MAX_ROUTE_POINTS) is still
 * recorded as rasterised, so `rasterized == routes` once everything is counted.
 * Returns the number of base cells added (0 when skipped).
 */
export async function rasterizeWorkout(
	pool: Pool,
	workoutId: string,
	workoutType: string,
	points: RoutePointInput[],
): Promise<number> {
	let cells: Set<number>;
	if (points.length > MAX_ROUTE_POINTS) {
		console.warn(
			`Heatmap: skipping ${workoutId}, ${points.length} points > ${MAX_ROUTE_POINTS}`,
		);
		cells = new Set();
	} else {
		cells = rasterizeRoute(points);
	}
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		// Shared with the rebuild's TRUNCATE so the two never interleave.
		await client.query("SELECT pg_advisory_xact_lock($1)", [HEATMAP_LOCK_KEY]);
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
	/** "rebuild" truncates and recounts everything; "reconcile" counts only uncounted routes. */
	mode: "rebuild" | "reconcile" | null;
	total: number;
	done: number;
	started_at: string | null;
	finished_at: string | null;
	error: string | null;
}

const rebuildState: RebuildState = {
	running: false,
	mode: null,
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
 * Recount routes one at a time in the background; poll getRebuildState().
 * mode "rebuild" truncates first and recounts everything; "reconcile" counts
 * only routes without a heatmap_rasterized row (a crash between a sync's
 * COMMIT and its rasterisation, or a fresh deployment). Returns false if a
 * run is already in progress.
 */
export function startRebuild(
	pool: Pool,
	mode: "rebuild" | "reconcile" = "rebuild",
): boolean {
	if (rebuildState.running) return false;
	rebuildState.running = true;
	rebuildState.mode = mode;
	rebuildState.total = 0;
	rebuildState.done = 0;
	rebuildState.started_at = new Date().toISOString();
	rebuildState.finished_at = null;
	rebuildState.error = null;

	void (async () => {
		try {
			if (mode === "rebuild") {
				const client = await pool.connect();
				try {
					await client.query("BEGIN");
					await client.query("SELECT pg_advisory_xact_lock($1)", [
						HEATMAP_LOCK_KEY,
					]);
					await client.query("TRUNCATE heatmap_cells, heatmap_rasterized");
					await client.query("COMMIT");
				} catch (error) {
					await client.query("ROLLBACK");
					throw error;
				} finally {
					client.release();
				}
			}
			const ids = await pool.query<{ id: string; workout_type: string }>(
				`SELECT w.id, w.workout_type
				 FROM workouts w JOIN workout_routes r ON r.workout_id = w.id
				 LEFT JOIN heatmap_rasterized h ON h.workout_id = w.id
				 WHERE h.workout_id IS NULL
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
			console.log(`Heatmap ${mode}: ${rebuildState.done} routes counted`);
		} catch (error) {
			rebuildState.error =
				error instanceof Error ? error.message : String(error);
			console.error(`Heatmap ${mode} failed:`, error);
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
	// Null prototype: workout_type is user data and could be "__proto__".
	const cells: Record<string, number[]> = Object.create(null);
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

// MARK: - Vector tiles

/** Tiles are served for zoom 0..TILE_MAX_ZOOM; Mapbox overzooms beyond that. */
export const TILE_MAX_ZOOM = BASE_ZOOM;
const TILE_EXTENT = 4096;
/** Widest circle the dashboard draws at an integer zoom, in extent units (3 px of a 512 px tile). */
const TILE_BUFFER_UNITS = 24;

/**
 * Which stored zoom feeds a tile at zoom z. A tile bounds its own payload, so
 * the finest cells can go much further out than the old viewport fetch: z13
 * from tile zoom 9 (≤ 2^12 cells per side, ~45k cells in the densest tile),
 * the rollups only below that.
 */
export function storedZoomForTile(z: number): number {
	if (z >= 9) return 13;
	if (z >= 6) return 10;
	return 7;
}

/**
 * Mapbox Vector Tile (z, x, y): one layer per activity group, one point per
 * cell at its centre, property `c` = activities through the cell summed over
 * the group's raw types. Includes a small buffer past the tile edge so circles
 * are not clipped. Returns null for an empty tile.
 */
export async function getTile(
	pool: Pool,
	z: number,
	x: number,
	y: number,
): Promise<Buffer | null> {
	const stored = storedZoomForTile(z);
	const side = 256 * 2 ** (stored - z); // cells per tile side
	const unit = TILE_EXTENT / side; // extent units per cell
	const margin = Math.ceil(TILE_BUFFER_UNITS / unit) + 1;
	const x0 = x * side;
	const y0 = y * side;
	const params: unknown[] = [
		stored,
		x0 - margin,
		x0 + side - 1 + margin,
		y0 - margin,
		y0 + side - 1 + margin,
	];
	const groupSql = groupCaseSql(params);
	const result = await pool.query<{
		x: number;
		y: number;
		g: ActivityGroup;
		c: number;
	}>(
		`SELECT x, y, ${groupSql} AS g, sum(count)::int AS c
		 FROM heatmap_cells
		 WHERE zoom = $1 AND x BETWEEN $2 AND $3 AND y BETWEEN $4 AND $5
		 GROUP BY x, y, g`,
		params,
	);
	if (result.rows.length === 0) return null;
	type VtFeature = {
		type: 1;
		geometry: [number, number][];
		tags: { c: number };
	};
	const layers: Record<string, { features: VtFeature[] }> = {};
	for (const row of result.rows) {
		let layer = layers[row.g];
		if (!layer) {
			layer = { features: [] };
			layers[row.g] = layer;
		}
		layer.features.push({
			type: 1,
			geometry: [
				[
					Math.round((row.x - x0 + 0.5) * unit),
					Math.round((row.y - y0 + 0.5) * unit),
				],
			],
			tags: { c: row.c },
		});
	}
	// vt-pbf's typings want geojson-vt tile objects; this is the same shape.
	return Buffer.from(
		fromGeojsonVt(layers as unknown as Parameters<typeof fromGeojsonVt>[0], {
			extent: TILE_EXTENT,
			version: 2,
		}),
	);
}

export interface HeatmapWorkout {
	id: string;
	workout_type: string;
	group: ActivityGroup;
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
		group: groupOf(row.workout_type),
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
	/** Changes whenever a route is (re)counted; the dashboard keys tile URLs on it. */
	version: string;
	rebuild: RebuildState;
}

export async function getStatus(pool: Pool): Promise<HeatmapStatus> {
	const cells = await pool.query<{ zoom: number; n: string }>(
		"SELECT zoom, count(*) AS n FROM heatmap_cells GROUP BY zoom ORDER BY zoom",
	);
	const counts = await pool.query<{
		rasterized: string;
		latest: string | null;
		routes: string;
	}>(
		`SELECT (SELECT count(*) FROM heatmap_rasterized) AS rasterized,
		        (SELECT extract(epoch FROM max(rasterized_at))::bigint FROM heatmap_rasterized) AS latest,
		        (SELECT count(*) FROM workout_routes) AS routes`,
	);
	const byZoom: Record<string, number> = {};
	for (const row of cells.rows) byZoom[String(row.zoom)] = Number(row.n);
	const { rasterized, latest, routes } = counts.rows[0];
	return {
		cells_by_zoom: byZoom,
		rasterized_workouts: Number(rasterized),
		routes: Number(routes),
		version: `${rasterized}-${latest ?? 0}`,
		rebuild: getRebuildState(),
	};
}
