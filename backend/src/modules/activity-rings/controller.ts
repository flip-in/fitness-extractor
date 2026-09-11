import type { Request, Response } from "express";
import { getPool } from "../../db/pool.js";
import { DEFAULT_USER_ID } from "../../shared/defaultUser.js";
import {
	type ActivityRingData,
	getActivityRingsByDate,
	upsertActivityRing,
} from "./service.js";
/**
 * GET /api/activity-rings/:date
 * Get activity rings for a specific date
 */
export async function getActivityRingsByDateHandler(
	req: Request<{ date: string }>,
	res: Response,
): Promise<void> {
	try {
		const { date } = req.params;
		const userId = (req.query.user_id as string) || DEFAULT_USER_ID;

		if (!date) {
			res.status(400).json({
				error: "Bad Request",
				message: "date parameter is required",
			});
			return;
		}

		// Validate date format (YYYY-MM-DD)
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
		if (!dateRegex.test(date)) {
			res.status(400).json({
				error: "Bad Request",
				message: "date must be in YYYY-MM-DD format",
			});
			return;
		}

		const pool = getPool();
		const activityRings = await getActivityRingsByDate(pool, userId, date);

		if (!activityRings) {
			res.status(404).json({
				success: false,
				message: "No activity ring data for this date",
			});
			return;
		}

		res.status(200).json({
			success: true,
			activity_rings: activityRings,
		});
	} catch (error) {
		console.error("Error in getActivityRingsByDateHandler:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch activity rings",
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
