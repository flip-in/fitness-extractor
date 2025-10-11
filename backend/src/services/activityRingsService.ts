import type { Pool, QueryResult } from "pg";

export interface ActivityRingData {
	date: string; // ISO date string (YYYY-MM-DD)
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

export interface SyncResult {
	success: boolean;
	ringId?: string;
	error?: string;
	updated?: boolean; // True if existing record was updated
}

/**
 * Insert or update activity rings data in the database
 * Returns success: true if inserted/updated
 * Note: Activity rings are updated if they already exist for a given date
 */
export async function upsertActivityRing(
	pool: Pool,
	userId: string,
	ring: ActivityRingData,
): Promise<SyncResult> {
	const client = await pool.connect();

	try {
		await client.query("BEGIN");

		const query = `
			INSERT INTO activity_rings (
				user_id, date,
				move_goal_kcal, move_actual_kcal, move_percent,
				exercise_goal_minutes, exercise_actual_minutes, exercise_percent,
				stand_goal_hours, stand_actual_hours, stand_percent
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (user_id, date)
			DO UPDATE SET
				move_goal_kcal = EXCLUDED.move_goal_kcal,
				move_actual_kcal = EXCLUDED.move_actual_kcal,
				move_percent = EXCLUDED.move_percent,
				exercise_goal_minutes = EXCLUDED.exercise_goal_minutes,
				exercise_actual_minutes = EXCLUDED.exercise_actual_minutes,
				exercise_percent = EXCLUDED.exercise_percent,
				stand_goal_hours = EXCLUDED.stand_goal_hours,
				stand_actual_hours = EXCLUDED.stand_actual_hours,
				stand_percent = EXCLUDED.stand_percent,
				updated_at = NOW()
			RETURNING id, (xmax = 0) AS inserted
		`;

		const values = [
			userId,
			ring.date,
			ring.move_goal_kcal,
			ring.move_actual_kcal,
			ring.move_percent,
			ring.exercise_goal_minutes,
			ring.exercise_actual_minutes,
			ring.exercise_percent,
			ring.stand_goal_hours,
			ring.stand_actual_hours,
			ring.stand_percent,
		];

		const result: QueryResult = await client.query(query, values);

		const ringId = result.rows[0].id;
		const wasInserted = result.rows[0].inserted;

		await client.query("COMMIT");

		return {
			success: true,
			ringId,
			updated: !wasInserted, // True if it was an UPDATE, false if INSERT
		};
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error upserting activity ring:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	} finally {
		client.release();
	}
}
