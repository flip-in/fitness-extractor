import type { Request, Response } from "express";
import { getPool } from "../db/pool.js";
import {
	calculateSummaryStats,
	getActivityRingsByDate,
	getHealthMetricsByType,
	getRecentActivityRings,
	getRecentWorkouts,
	getWorkoutById,
	getWorkoutRoute,
} from "../services/dashboardService.js";

// Default user ID for MVP (single user)
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

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
 * GET /api/workout/:id
 * Get detailed workout information
 */
export async function getWorkoutDetails(
	req: Request,
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
 * GET /api/workout/:id/route
 * Get GPS route data for a workout
 */
export async function getWorkoutRouteData(
	req: Request,
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
 * GET /api/activity-rings/:date
 * Get activity rings for a specific date
 */
export async function getActivityRingsByDateHandler(
	req: Request,
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
 * GET /api/health-metrics/:metricType
 * Get health metrics of a specific type within a date range
 */
export async function getHealthMetrics(
	req: Request,
	res: Response,
): Promise<void> {
	try {
		const { metricType } = req.params;
		const userId = (req.query.user_id as string) || DEFAULT_USER_ID;
		const startDate = req.query.start_date as string;
		const endDate = req.query.end_date as string;

		// Validation
		if (!metricType) {
			res.status(400).json({
				error: "Bad Request",
				message: "metricType parameter is required",
			});
			return;
		}

		if (!startDate || !endDate) {
			res.status(400).json({
				error: "Bad Request",
				message: "start_date and end_date query parameters are required",
			});
			return;
		}

		const pool = getPool();
		const result = await getHealthMetricsByType(
			pool,
			userId,
			metricType,
			startDate,
			endDate,
		);

		res.status(200).json({
			success: true,
			metric_type: metricType,
			unit: result.unit,
			data: result.data,
		});
	} catch (error) {
		console.error("Error in getHealthMetrics:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: "Failed to fetch health metrics",
		});
	}
}
