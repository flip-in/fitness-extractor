import type { Request, Response } from "express";
import { getPool } from "../db/pool.js";
import { insertWorkout, type WorkoutData } from "../services/workoutService.js";

/**
 * POST /api/sync/workouts
 * Sync workout data from HealthKit
 */
export async function syncWorkouts(req: Request, res: Response): Promise<void> {
	try {
		const { user_id, workouts } = req.body;

		// Validation
		if (!user_id || !workouts || !Array.isArray(workouts)) {
			res.status(400).json({
				error: "Bad Request",
				message: "user_id and workouts array are required",
			});
			return;
		}

		const pool = getPool();
		let synced = 0;
		let skipped = 0;
		const errors: Array<{ healthkit_uuid: string; error: string }> = [];

		// Process each workout
		for (const workout of workouts as WorkoutData[]) {
			const result = await insertWorkout(pool, user_id, workout);

			if (result.success) {
				synced++;
			} else if (result.error === "Duplicate workout") {
				skipped++;
			} else {
				errors.push({
					healthkit_uuid: workout.healthkit_uuid,
					error: result.error || "Unknown error",
				});
			}
		}

		// Return appropriate status code
		if (errors.length === workouts.length) {
			// All failed
			res.status(500).json({
				success: false,
				synced,
				skipped,
				errors,
			});
			return;
		}

		if (errors.length > 0) {
			// Partial success
			res.status(207).json({
				success: true,
				synced,
				skipped,
				errors,
			});
			return;
		}

		// All succeeded (or were duplicates)
		res.status(200).json({
			success: true,
			synced,
			skipped,
			errors: [],
		});
	} catch (error) {
		console.error("Error in syncWorkouts:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to sync workouts",
		});
	}
}
