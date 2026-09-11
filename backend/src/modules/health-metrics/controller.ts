import type { Request, Response } from "express";
import { getPool } from "../../db/pool.js";
import { DEFAULT_USER_ID } from "../../shared/defaultUser.js";
import {
	getHealthMetricsByType,
	type HealthMetricData,
	insertHealthMetrics,
} from "./service.js";
/**
 * GET /api/health-metrics/:metricType
 * Get health metrics of a specific type within a date range
 */
export async function getHealthMetrics(
	req: Request<{ metricType: string }>,
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
		const { synced, skipped, errors } = await insertHealthMetrics(
			pool,
			user_id,
			metrics as HealthMetricData[],
		);

		// Return appropriate status code
		if (metrics.length > 0 && errors.length === metrics.length) {
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
