import type { Request, Response } from "express";
import { getPool } from "../db/pool.js";
import {
	type ActivityRingData,
	upsertActivityRing,
} from "../services/activityRingsService.js";
import {
	type HealthMetricData,
	insertHealthMetric,
} from "../services/healthMetricsService.js";
import {
	getSyncAnchor,
	type SyncAnchorData,
	upsertSyncAnchor,
} from "../services/syncAnchorsService.js";
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

/**
 * POST /api/sync/health-metrics
 * Sync health metrics data from HealthKit
 */
export async function syncHealthMetrics(
	req: Request,
	res: Response,
): Promise<void> {
	try {
		const { user_id, metrics } = req.body;

		// Validation
		if (!user_id || !metrics || !Array.isArray(metrics)) {
			res.status(400).json({
				error: "Bad Request",
				message: "user_id and metrics array are required",
			});
			return;
		}

		const pool = getPool();
		let synced = 0;
		let skipped = 0;
		const errors: Array<{ healthkit_uuid: string; error: string }> = [];

		// Process each metric
		for (const metric of metrics as HealthMetricData[]) {
			const result = await insertHealthMetric(pool, user_id, metric);

			if (result.success) {
				synced++;
			} else if (result.error === "Duplicate metric") {
				skipped++;
			} else {
				errors.push({
					healthkit_uuid: metric.healthkit_uuid,
					error: result.error || "Unknown error",
				});
			}
		}

		// Return appropriate status code
		if (errors.length === metrics.length) {
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
		console.error("Error in syncHealthMetrics:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to sync health metrics",
		});
	}
}

/**
 * POST /api/sync/activity-rings
 * Sync activity rings data from HealthKit
 */
export async function syncActivityRings(
	req: Request,
	res: Response,
): Promise<void> {
	try {
		const { user_id, activity_rings } = req.body;

		// Validation
		if (!user_id || !activity_rings || !Array.isArray(activity_rings)) {
			res.status(400).json({
				error: "Bad Request",
				message: "user_id and activity_rings array are required",
			});
			return;
		}

		const pool = getPool();
		let synced = 0;
		let updated = 0;
		const errors: Array<{ date: string; error: string }> = [];

		// Process each activity ring
		for (const ring of activity_rings as ActivityRingData[]) {
			const result = await upsertActivityRing(pool, user_id, ring);

			if (result.success) {
				if (result.updated) {
					updated++;
				} else {
					synced++;
				}
			} else {
				errors.push({
					date: ring.date,
					error: result.error || "Unknown error",
				});
			}
		}

		// Return appropriate status code
		if (errors.length === activity_rings.length) {
			// All failed
			res.status(500).json({
				success: false,
				synced,
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
				updated,
				errors,
			});
			return;
		}

		// All succeeded
		res.status(200).json({
			success: true,
			synced,
			updated,
			errors: [],
		});
	} catch (error) {
		console.error("Error in syncActivityRings:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to sync activity rings",
		});
	}
}

/**
 * POST /api/sync/anchors
 * Update sync anchors for HealthKit data types
 */
export async function updateSyncAnchors(
	req: Request,
	res: Response,
): Promise<void> {
	try {
		const { user_id, anchors } = req.body;

		// Validation
		if (!user_id || !anchors || !Array.isArray(anchors)) {
			res.status(400).json({
				error: "Bad Request",
				message: "user_id and anchors array are required",
			});
			return;
		}

		const pool = getPool();
		let synced = 0;
		let updated = 0;
		const errors: Array<{ data_type: string; error: string }> = [];

		// Process each anchor
		for (const anchor of anchors as SyncAnchorData[]) {
			const result = await upsertSyncAnchor(pool, user_id, anchor);

			if (result.success) {
				if (result.updated) {
					updated++;
				} else {
					synced++;
				}
			} else {
				errors.push({
					data_type: anchor.data_type,
					error: result.error || "Unknown error",
				});
			}
		}

		// Return appropriate status code
		if (errors.length === anchors.length) {
			// All failed
			res.status(500).json({
				success: false,
				synced,
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
				updated,
				errors,
			});
			return;
		}

		// All succeeded
		res.status(200).json({
			success: true,
			synced,
			updated,
			errors: [],
		});
	} catch (error) {
		console.error("Error in updateSyncAnchors:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to update sync anchors",
		});
	}
}

/**
 * GET /api/sync/anchors/:userId/:dataType
 * Get the latest sync anchor for a specific data type
 */
export async function getAnchor(req: Request, res: Response): Promise<void> {
	try {
		const { userId, dataType } = req.params;

		// Validation
		if (!userId || !dataType) {
			res.status(400).json({
				error: "Bad Request",
				message: "userId and dataType are required",
			});
			return;
		}

		const pool = getPool();
		const result = await getSyncAnchor(pool, userId, dataType);

		if (!result.success) {
			res.status(500).json({
				error: "Internal Server Error",
				message: result.error || "Failed to get sync anchor",
			});
			return;
		}

		if (!result.anchor) {
			res.status(404).json({
				error: "Not Found",
				message: "No sync anchor found for this user and data type",
			});
			return;
		}

		res.status(200).json({
			success: true,
			anchor: result.anchor,
		});
	} catch (error) {
		console.error("Error in getAnchor:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to get sync anchor",
		});
	}
}
