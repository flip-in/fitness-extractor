import type { Request, Response } from "express";
import { getPool } from "../db/pool.js";
import {
	getCells,
	getStatus,
	getTile,
	listWorkoutsWithRoutes,
	startRebuild,
	TILE_MAX_ZOOM,
	ZOOMS,
} from "../services/heatmapService.js";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

/**
 * GET /api/heatmap/cells?z=14&bbox=west,south,east,north[&types=Cycling,Running]
 * z must be one of the stored zooms (ZOOMS: 14, 11, 8).
 */
export async function getHeatmapCells(
	req: Request,
	res: Response,
): Promise<void> {
	const zoom = Number.parseInt(req.query.z as string, 10);
	if (!(ZOOMS as readonly number[]).includes(zoom)) {
		res.status(400).json({
			error: "Bad Request",
			message: `z must be one of ${ZOOMS.join(", ")}`,
		});
		return;
	}
	const bbox = String(req.query.bbox ?? "")
		.split(",")
		.map((v) => Number.parseFloat(v));
	if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
		res.status(400).json({
			error: "Bad Request",
			message: "bbox must be west,south,east,north",
		});
		return;
	}
	const [west, south, east, north] = bbox;
	if (
		west >= east ||
		south >= north ||
		Math.abs(south) > 90 ||
		Math.abs(north) > 90
	) {
		res.status(400).json({
			error: "Bad Request",
			message: "bbox out of range",
		});
		return;
	}
	const types = req.query.types
		? String(req.query.types)
				.split(",")
				.filter((t) => t.length > 0)
		: null;
	try {
		const data = await getCells(
			getPool(),
			zoom,
			[west, south, east, north],
			types,
		);
		res.json({ success: true, data });
	} catch (error) {
		console.error("Error fetching heatmap cells:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch heatmap cells",
		});
	}
}

/**
 * GET /api/heatmap/tiles/:z/:x/:y.mvt[?v=version] — Mapbox Vector Tile, one
 * layer per activity group. 204 for an empty tile. With ?v= (the heatmap
 * version from /status, which the dashboard puts in the URL so a recount or a
 * renderer change gives a new URL) the response is cached for a year; a bare
 * URL is not cached.
 */
const TILE_COORD = /^\d{1,6}$/;
export async function getHeatmapTile(
	req: Request,
	res: Response,
): Promise<void> {
	const raw = [req.params.z, req.params.x, req.params.y].map(String);
	const [z, x, y] = raw.map((s) =>
		TILE_COORD.test(s) ? Number(s) : Number.NaN,
	);
	const n = 2 ** z;
	if (
		!Number.isInteger(z) ||
		!Number.isInteger(x) ||
		!Number.isInteger(y) ||
		z < 0 ||
		z > TILE_MAX_ZOOM ||
		x < 0 ||
		x >= n ||
		y < 0 ||
		y >= n
	) {
		res.status(400).json({
			error: "Bad Request",
			message: `tile must be 0 <= z <= ${TILE_MAX_ZOOM}, 0 <= x, y < 2^z`,
		});
		return;
	}
	try {
		const tile = await getTile(getPool(), z, x, y);
		const versioned = typeof req.query.v === "string" && req.query.v !== "";
		res.set(
			"Cache-Control",
			versioned ? "private, max-age=31536000, immutable" : "no-cache",
		);
		if (!tile) {
			res.status(204).end();
			return;
		}
		res.type("application/vnd.mapbox-vector-tile").send(tile);
	} catch (error) {
		console.error("Error building heatmap tile:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to build heatmap tile",
		});
	}
}

/** GET /api/heatmap/workouts — every workout with a route, for the sidebar. */
export async function getHeatmapWorkouts(
	_req: Request,
	res: Response,
): Promise<void> {
	try {
		const workouts = await listWorkoutsWithRoutes(getPool(), DEFAULT_USER_ID);
		res.json({ success: true, data: { workouts } });
	} catch (error) {
		console.error("Error listing heatmap workouts:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to list workouts",
		});
	}
}

/** GET /api/heatmap/status — cell counts and rebuild progress. */
export async function getHeatmapStatus(
	_req: Request,
	res: Response,
): Promise<void> {
	try {
		res.json({ success: true, data: await getStatus(getPool()) });
	} catch (error) {
		console.error("Error fetching heatmap status:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch heatmap status",
		});
	}
}

/** POST /api/heatmap/rebuild — truncate and recount every route, in the background. */
export function rebuildHeatmap(_req: Request, res: Response): void {
	const started = startRebuild(getPool(), "rebuild");
	res.status(started ? 202 : 409).json({
		success: started,
		message: started ? "Rebuild started" : "Rebuild already running",
	});
}

/** POST /api/heatmap/reconcile — count only routes not yet in heatmap_rasterized. */
export function reconcileHeatmap(_req: Request, res: Response): void {
	const started = startRebuild(getPool(), "reconcile");
	res.status(started ? 202 : 409).json({
		success: started,
		message: started ? "Reconcile started" : "Rebuild already running",
	});
}
