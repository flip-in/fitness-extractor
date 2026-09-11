import type { Request, Response } from "express";
import { getPool } from "../../db/pool.js";
import {
	getWorkoutById,
	getWorkoutRoute,
	insertWorkout,
	setWorkoutFavorite,
	type WorkoutData,
} from "./service.js";
/**
 * GET /api/workouts/:id
 * Get detailed workout information
 */
export async function getWorkoutDetails(
	req: Request<{ id: string }>,
	res: Response,
): Promise<void> {
	try {
		const { id } = req.params;

		if (!id) {
			res.status(400).json({
				error: "Bad Request",
				message: "workout id is required",
			});
			return;
		}

		const pool = getPool();
		const workout = await getWorkoutById(pool, id);

		if (!workout) {
			res.status(404).json({
				success: false,
				message: "Workout not found",
			});
			return;
		}

		res.status(200).json({
			success: true,
			workout,
		});
	} catch (error) {
		console.error("Error in getWorkoutDetails:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch workout details",
		});
	}
}

/**
 * PUT /api/workouts/:id/favorite  body: { is_favorite: boolean }
 * Set or clear the favorite flag. Idempotent.
 */
export async function setWorkoutFavoriteFlag(
	req: Request<{ id: string }>,
	res: Response,
): Promise<void> {
	try {
		const { id } = req.params;
		const isFavorite = req.body?.is_favorite;

		if (!id || typeof isFavorite !== "boolean") {
			res.status(400).json({
				error: "Bad Request",
				message: "workout id and boolean is_favorite are required",
			});
			return;
		}

		const result = await setWorkoutFavorite(getPool(), id, isFavorite);

		if (!result) {
			res.status(404).json({
				success: false,
				message: "Workout not found",
			});
			return;
		}

		res.status(200).json({ success: true, data: result });
	} catch (error) {
		console.error("Error in setWorkoutFavoriteFlag:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to update favorite",
		});
	}
}

/**
 * GET /api/workouts/:id/route
 * Get GPS route data for a workout
 */
export async function getWorkoutRouteData(
	req: Request<{ id: string }>,
	res: Response,
): Promise<void> {
	try {
		const { id } = req.params;

		if (!id) {
			res.status(400).json({
				error: "Bad Request",
				message: "workout id is required",
			});
			return;
		}

		const pool = getPool();
		const route = await getWorkoutRoute(pool, id);

		if (!route) {
			res.status(404).json({
				success: false,
				message: "No route data for this workout",
			});
			return;
		}

		res.status(200).json({
			success: true,
			route,
		});
	} catch (error) {
		console.error("Error in getWorkoutRouteData:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch workout route",
		});
	}
}

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
		let updated = 0; // existing workouts that gained a route
		const errors: Array<{ healthkit_uuid: string; error: string }> = [];

		// Process each workout
		for (const workout of workouts as WorkoutData[]) {
			const result = await insertWorkout(pool, user_id, workout);

			if (result.success && result.routeAttached) {
				updated++;
			} else if (result.success) {
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
				updated,
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
				updated,
				errors,
			});
			return;
		}

		// All succeeded (or were duplicates)
		res.status(200).json({
			success: true,
			synced,
			skipped,
			updated,
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
