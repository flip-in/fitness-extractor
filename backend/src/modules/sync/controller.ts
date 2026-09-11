import type { Request, Response } from "express";
import { getPool } from "../../db/pool.js";
import {
	getSyncAnchor,
	type SyncAnchorData,
	upsertSyncAnchor,
} from "./service.js";
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
export async function getAnchor(
	req: Request<{ userId: string; dataType: string }>,
	res: Response,
): Promise<void> {
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
