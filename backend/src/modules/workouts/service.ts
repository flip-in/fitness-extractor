import type { Pool, QueryResult } from "pg";
import { rasterizeWorkout } from "../heatmap/service.js";

export interface WorkoutData {
	healthkit_uuid: string;
	workout_type: string;
	start_date: string;
	end_date: string;
	duration_seconds: number;
	total_distance_meters?: number;
	total_energy_burned_kcal?: number;
	avg_heart_rate_bpm?: number;
	max_heart_rate_bpm?: number;
	source_name?: string;
	source_bundle_id?: string;
	device_name?: string;
	metadata?: Record<string, unknown>;
	route?: {
		points: Array<{
			lat: number;
			lon: number;
			timestamp: string;
			altitude?: number;
			speed?: number;
			horizontal_accuracy?: number;
		}>;
	};
}

export interface SyncResult {
	success: boolean;
	workoutId?: string;
	/** True when the workout already existed and this call only attached its route. */
	routeAttached?: boolean;
	error?: string;
}

/**
 * Insert a workout into the database.
 *
 * The iOS app syncs workout rows first (cheap, safe inside a background wake) and
 * sends GPS routes later, one workout at a time. So a duplicate workout that
 * arrives *with* a route, for a row that has none yet, attaches the route rather
 * than being skipped. Any other duplicate is skipped unchanged.
 */
export async function insertWorkout(
	pool: Pool,
	userId: string,
	workout: WorkoutData,
): Promise<SyncResult> {
	const client = await pool.connect();

	try {
		await client.query("BEGIN");

		// Insert workout
		const workoutQuery = `
			INSERT INTO workouts (
				user_id, healthkit_uuid, workout_type, start_date, end_date,
				duration_seconds, total_distance_meters, total_energy_burned_kcal,
				avg_heart_rate_bpm, max_heart_rate_bpm, source_name,
				source_bundle_id, device_name, metadata
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
			ON CONFLICT (healthkit_uuid) DO NOTHING
			RETURNING id
		`;

		const workoutValues = [
			userId,
			workout.healthkit_uuid,
			workout.workout_type,
			workout.start_date,
			workout.end_date,
			workout.duration_seconds,
			workout.total_distance_meters || null,
			workout.total_energy_burned_kcal || null,
			workout.avg_heart_rate_bpm || null,
			workout.max_heart_rate_bpm || null,
			workout.source_name || null,
			workout.source_bundle_id || null,
			workout.device_name || null,
			workout.metadata ? JSON.stringify(workout.metadata) : null,
		];

		const result: QueryResult = await client.query(workoutQuery, workoutValues);
		const inserted = result.rows.length > 0;
		const hasRoute = (workout.route?.points?.length ?? 0) > 0;

		let workoutId: string;
		if (inserted) {
			workoutId = result.rows[0].id;
		} else {
			// Duplicate. Only worth continuing if we can attach a missing route.
			if (!hasRoute) {
				await client.query("ROLLBACK");
				return { success: false, error: "Duplicate workout" };
			}

			const existing: QueryResult = await client.query(
				`SELECT w.id
				 FROM workouts w
				 LEFT JOIN workout_routes r ON r.workout_id = w.id
				 WHERE w.healthkit_uuid = $1 AND r.id IS NULL`,
				[workout.healthkit_uuid],
			);

			if (existing.rows.length === 0) {
				await client.query("ROLLBACK");
				return { success: false, error: "Duplicate workout" };
			}

			workoutId = existing.rows[0].id;
		}

		// Insert route if provided
		if (hasRoute && workout.route) {
			const points = workout.route.points;

			// Calculate bounding box
			const lats = points.map((p) => p.lat);
			const lons = points.map((p) => p.lon);

			const routeQuery = `
				INSERT INTO workout_routes (
					workout_id, route_points, total_points,
					min_latitude, max_latitude, min_longitude, max_longitude
				) VALUES ($1, $2, $3, $4, $5, $6, $7)
			`;

			const routeValues = [
				workoutId,
				JSON.stringify(points),
				points.length,
				Math.min(...lats),
				Math.max(...lats),
				Math.min(...lons),
				Math.max(...lons),
			];

			await client.query(routeQuery, routeValues);
		}

		await client.query("COMMIT");

		// Count the new route into the GPS heatmap (milliseconds for one route).
		// After the commit and outside its transaction: a heatmap failure must
		// not fail the sync, and the iOS app has a 30s wake to get its answer.
		if (hasRoute && workout.route) {
			try {
				await rasterizeWorkout(
					pool,
					workoutId,
					workout.workout_type,
					workout.route.points,
				);
			} catch (error) {
				console.error(`Heatmap rasterise failed for ${workoutId}:`, error);
			}
		}

		return {
			success: true,
			workoutId,
			routeAttached: !inserted,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error inserting workout:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	} finally {
		client.release();
	}
}

// ---- Read side: dashboard lists, detail, route -------------------------------

export interface WorkoutSummary {
	id: string;
	workout_type: string;
	start_date: string;
	end_date: string;
	duration_seconds: number;
	total_distance_meters: number | null;
	total_energy_burned_kcal: number | null;
	avg_heart_rate_bpm: number | null;
	max_heart_rate_bpm: number | null;
	has_route: boolean;
	is_favorite: boolean;
	metadata: Record<string, unknown> | null;
}

export interface WorkoutDetail {
	id: string;
	workout_type: string;
	start_date: string;
	end_date: string;
	duration_seconds: number;
	total_distance_meters: number | null;
	total_energy_burned_kcal: number | null;
	avg_heart_rate_bpm: number | null;
	max_heart_rate_bpm: number | null;
	source_name: string | null;
	device_name: string | null;
	metadata: Record<string, unknown> | null;
}

export interface RoutePoint {
	lat: number;
	lon: number;
	timestamp: string;
	altitude?: number;
	speed?: number;
	horizontal_accuracy?: number;
}

export interface WorkoutRoute {
	workout_id: string;
	total_points: number;
	points: RoutePoint[];
	bounds: {
		min_lat: number;
		max_lat: number;
		min_lon: number;
		max_lon: number;
	};
}

const WORKOUT_SUMMARY_SELECT = `
	SELECT
		w.id,
		w.workout_type,
		w.start_date,
		w.end_date,
		w.duration_seconds,
		w.total_distance_meters,
		w.total_energy_burned_kcal,
		w.avg_heart_rate_bpm,
		w.max_heart_rate_bpm,
		EXISTS(SELECT 1 FROM workout_routes wr WHERE wr.workout_id = w.id) as has_route,
		COALESCE(a.is_favorite, false) as is_favorite,
		w.metadata
	FROM workouts w
	LEFT JOIN workout_annotations a ON a.healthkit_uuid = w.healthkit_uuid
`;

/**
 * Get recent workouts for dashboard (last N days)
 */
export async function getRecentWorkouts(
	pool: Pool,
	userId: string,
	days: number,
): Promise<WorkoutSummary[]> {
	const query = `
		${WORKOUT_SUMMARY_SELECT}
		WHERE w.user_id = $1
		AND w.start_date >= NOW() - INTERVAL '1 day' * $2
		ORDER BY w.start_date DESC
	`;

	const result = await pool.query(query, [userId, days]);
	return result.rows;
}

/**
 * All favorited workouts, any date. Favorites are rare (hand-picked), so no
 * pagination; the partial index on workout_annotations keeps this cheap.
 */
export async function getFavoriteWorkouts(
	pool: Pool,
	userId: string,
): Promise<WorkoutSummary[]> {
	const query = `
		${WORKOUT_SUMMARY_SELECT}
		WHERE w.user_id = $1 AND a.is_favorite
		ORDER BY w.start_date DESC
	`;

	const result = await pool.query(query, [userId]);
	return result.rows;
}

/**
 * Set or clear the favorite flag on a workout. Annotations are keyed on the
 * HealthKit UUID (see migrations/003) so the workout row is looked up first.
 * Returns null when the workout does not exist.
 */
export async function setWorkoutFavorite(
	pool: Pool,
	workoutId: string,
	isFavorite: boolean,
): Promise<{ id: string; is_favorite: boolean } | null> {
	const query = `
		INSERT INTO workout_annotations (healthkit_uuid, is_favorite, favorited_at)
		SELECT healthkit_uuid, $2, CASE WHEN $2 THEN NOW() END
		FROM workouts WHERE id = $1
		ON CONFLICT (healthkit_uuid) DO UPDATE SET
			is_favorite = EXCLUDED.is_favorite,
			favorited_at = EXCLUDED.favorited_at,
			updated_at = NOW()
		RETURNING is_favorite
	`;

	const result = await pool.query(query, [workoutId, isFavorite]);
	if (result.rows.length === 0) return null;
	return { id: workoutId, is_favorite: result.rows[0].is_favorite };
}

/**
 * Get detailed information for a single workout
 */
export async function getWorkoutById(
	pool: Pool,
	workoutId: string,
): Promise<WorkoutDetail | null> {
	const query = `
		SELECT
			id,
			workout_type,
			start_date,
			end_date,
			duration_seconds,
			total_distance_meters,
			total_energy_burned_kcal,
			avg_heart_rate_bpm,
			max_heart_rate_bpm,
			source_name,
			device_name,
			metadata
		FROM workouts
		WHERE id = $1
	`;

	const result = await pool.query(query, [workoutId]);

	if (result.rows.length === 0) {
		return null;
	}

	return result.rows[0];
}

/**
 * Get GPS route data for a workout
 */
export async function getWorkoutRoute(
	pool: Pool,
	workoutId: string,
): Promise<WorkoutRoute | null> {
	const query = `
		SELECT
			workout_id,
			route_points,
			total_points,
			min_latitude,
			max_latitude,
			min_longitude,
			max_longitude
		FROM workout_routes
		WHERE workout_id = $1
	`;

	const result = await pool.query(query, [workoutId]);

	if (result.rows.length === 0) {
		return null;
	}

	const row = result.rows[0];

	return {
		workout_id: row.workout_id,
		total_points: row.total_points,
		points: row.route_points, // Already parsed from JSONB
		bounds: {
			min_lat: row.min_latitude,
			max_lat: row.max_latitude,
			min_lon: row.min_longitude,
			max_lon: row.max_longitude,
		},
	};
}
