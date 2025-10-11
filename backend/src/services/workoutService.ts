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
	error?: string;
}

/**
 * Insert a workout into the database
 * Returns success: true if inserted, or error if duplicate/failed
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

		// Check if workout was inserted (not a duplicate)
		if (result.rows.length === 0) {
			await client.query("ROLLBACK");
			return {
				success: false,
				error: "Duplicate workout",
			};
		}

		const workoutId = result.rows[0].id;

		// Insert route if provided
		if (workout.route?.points && workout.route.points.length > 0) {
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
