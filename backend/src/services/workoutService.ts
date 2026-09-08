import type { Pool, QueryResult } from "pg";

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
