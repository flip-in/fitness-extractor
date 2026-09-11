import type { Request, Response } from "express";
import { getPool } from "../../db/pool.js";
import { DEFAULT_USER_ID } from "../../shared/defaultUser.js";
import { getRecentActivityRings } from "../activity-rings/service.js";
import { getFavoriteWorkouts, getRecentWorkouts } from "../workouts/service.js";
import { calculateSummaryStats } from "./service.js";
/**
 * GET /api/dashboard/recent
 * Get recent dashboard data (workouts, activity rings, summary stats)
 */
export async function getRecentDashboardData(
	req: Request,
	res: Response,
): Promise<void> {
	try {
		// Parse query parameters
		const days = Number.parseInt(req.query.days as string, 10) || 7;
		const userId = (req.query.user_id as string) || DEFAULT_USER_ID;

		// Validate days parameter
		if (days < 1 || days > 90) {
			res.status(400).json({
				error: "Bad Request",
				message: "days parameter must be between 1 and 90",
			});
			return;
		}

		const pool = getPool();

		// Fetch all data in parallel
		const [workouts, activityRings, summary] = await Promise.all([
			getRecentWorkouts(pool, userId, days),
			getRecentActivityRings(pool, userId, days),
			calculateSummaryStats(pool, userId, days),
		]);

		res.status(200).json({
			success: true,
			data: {
				workouts,
				activity_rings: activityRings,
				summary,
			},
		});
	} catch (error) {
		console.error("Error in getRecentDashboardData:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch dashboard data",
		});
	}
}

/**
 * GET /api/dashboard/favorites
 * All favorited workouts, any date, newest first.
 */
export async function getFavoriteWorkoutList(
	req: Request,
	res: Response,
): Promise<void> {
	try {
		const userId = (req.query.user_id as string) || DEFAULT_USER_ID;
		const workouts = await getFavoriteWorkouts(getPool(), userId);
		res.status(200).json({ success: true, data: { workouts } });
	} catch (error) {
		console.error("Error in getFavoriteWorkoutList:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch favorite workouts",
		});
	}
}
