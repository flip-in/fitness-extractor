import type { Pool } from "pg";

// Types for dashboard responses
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
}

export interface ActivityRing {
	date: string;
	move_goal_kcal: number;
	move_actual_kcal: number;
	move_percent: number;
	exercise_goal_minutes: number;
	exercise_actual_minutes: number;
	exercise_percent: number;
	stand_goal_hours: number;
	stand_actual_hours: number;
	stand_percent: number;
}

export interface DashboardSummary {
	total_workouts: number;
	total_distance_km: number;
	total_calories: number;
	avg_workout_duration_minutes: number;
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

export interface HealthMetricData {
	value: number;
	start_date: string;
	end_date: string;
	source_name: string | null;
}

/**
 * Get recent workouts for dashboard (last N days)
 */
export async function getRecentWorkouts(
	pool: Pool,
	userId: string,
	days: number,
): Promise<WorkoutSummary[]> {
	const query = `
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
			EXISTS(SELECT 1 FROM workout_routes wr WHERE wr.workout_id = w.id) as has_route
		FROM workouts w
		WHERE w.user_id = $1
		AND w.start_date >= NOW() - INTERVAL '1 day' * $2
		ORDER BY w.start_date DESC
	`;

	const result = await pool.query(query, [userId, days]);
	return result.rows;
}

/**
 * Get recent activity rings (last N days)
 */
export async function getRecentActivityRings(
	pool: Pool,
	userId: string,
	days: number,
): Promise<ActivityRing[]> {
	const query = `
		SELECT
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
		FROM activity_rings
		WHERE user_id = $1
		AND date >= CURRENT_DATE - INTERVAL '1 day' * $2
		ORDER BY date DESC
	`;

	const result = await pool.query(query, [userId, days]);
	return result.rows;
}

/**
 * Calculate summary statistics for recent workouts
 */
export async function calculateSummaryStats(
	pool: Pool,
	userId: string,
	days: number,
): Promise<DashboardSummary> {
	const query = `
		SELECT
			COUNT(*) as total_workouts,
			COALESCE(SUM(total_distance_meters), 0) / 1000.0 as total_distance_km,
			COALESCE(SUM(total_energy_burned_kcal), 0) as total_calories,
			COALESCE(AVG(duration_seconds), 0) / 60.0 as avg_workout_duration_minutes
		FROM workouts
		WHERE user_id = $1
		AND start_date >= NOW() - INTERVAL '1 day' * $2
	`;

	const result = await pool.query(query, [userId, days]);
	const row = result.rows[0];

	return {
		total_workouts: Number.parseInt(row.total_workouts, 10),
		total_distance_km: Number.parseFloat(row.total_distance_km),
		total_calories: Number.parseFloat(row.total_calories),
		avg_workout_duration_minutes: Number.parseFloat(
			row.avg_workout_duration_minutes,
		),
	};
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

/**
 * Get activity rings for a specific date
 */
export async function getActivityRingsByDate(
	pool: Pool,
	userId: string,
	date: string,
): Promise<ActivityRing | null> {
	const query = `
		SELECT
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
		FROM activity_rings
		WHERE user_id = $1 AND date = $2
	`;

	const result = await pool.query(query, [userId, date]);

	if (result.rows.length === 0) {
		return null;
	}

	return result.rows[0];
}

/**
 * Get health metrics of a specific type within a date range
 */
export async function getHealthMetricsByType(
	pool: Pool,
	userId: string,
	metricType: string,
	startDate: string,
	endDate: string,
): Promise<{ unit: string; data: HealthMetricData[] }> {
	const query = `
		SELECT
			value,
			unit,
			start_date,
			end_date,
			source_name
		FROM health_metrics
		WHERE user_id = $1
		AND metric_type = $2
		AND start_date >= $3
		AND start_date <= $4
		ORDER BY start_date ASC
	`;

	const result = await pool.query(query, [
		userId,
		metricType,
		startDate,
		endDate,
	]);

	// Get unit from first row, or default to empty string
	const unit = result.rows.length > 0 ? result.rows[0].unit : "";

	return {
		unit,
		data: result.rows.map((row) => ({
			value: row.value,
			start_date: row.start_date,
			end_date: row.end_date,
			source_name: row.source_name,
		})),
	};
}
