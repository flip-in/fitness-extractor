import type { Pool } from "pg";
export interface DashboardSummary {
	total_workouts: number;
	total_distance_km: number;
	total_calories: number;
	avg_workout_duration_minutes: number;
	avg_heart_rate_bpm: number | null;
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
			COALESCE(AVG(duration_seconds), 0) / 60.0 as avg_workout_duration_minutes,
			AVG(avg_heart_rate_bpm) as avg_heart_rate_bpm
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
		avg_heart_rate_bpm: row.avg_heart_rate_bpm
			? Number.parseFloat(row.avg_heart_rate_bpm)
			: null,
	};
}
