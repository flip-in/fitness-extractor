import type { Pool, QueryResult } from "pg";

export interface SyncAnchorData {
	data_type: string;
	anchor_data: string;
}

export interface SyncResult {
	success: boolean;
	anchorId?: string;
	error?: string;
	updated?: boolean;
}

export interface AnchorResult {
	success: boolean;
	anchor?: {
		id: string;
		data_type: string;
		anchor_data: string;
		last_sync_at: string;
	};
	error?: string;
}

/**
 * Upsert a sync anchor for a user and data type
 * Returns success: true if inserted/updated
 */
export async function upsertSyncAnchor(
	pool: Pool,
	userId: string,
	anchor: SyncAnchorData,
): Promise<SyncResult> {
	const client = await pool.connect();

	try {
		await client.query("BEGIN");

		const query = `
			INSERT INTO sync_anchors (user_id, data_type, anchor_data, last_sync_at)
			VALUES ($1, $2, $3, NOW())
			ON CONFLICT (user_id, data_type)
			DO UPDATE SET
				anchor_data = EXCLUDED.anchor_data,
				last_sync_at = NOW()
			RETURNING id, (xmax = 0) AS inserted
		`;

		const values = [userId, anchor.data_type, anchor.anchor_data];

		const result: QueryResult = await client.query(query, values);

		const anchorId = result.rows[0].id;
		const wasInserted = result.rows[0].inserted;

		await client.query("COMMIT");

		return {
			success: true,
			anchorId,
			updated: !wasInserted,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error upserting sync anchor:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	} finally {
		client.release();
	}
}

/**
 * Get the latest sync anchor for a user and data type
 */
export async function getSyncAnchor(
	pool: Pool,
	userId: string,
	dataType: string,
): Promise<AnchorResult> {
	try {
		const query = `
			SELECT id, data_type, anchor_data, last_sync_at
			FROM sync_anchors
			WHERE user_id = $1 AND data_type = $2
		`;

		const result: QueryResult = await pool.query(query, [userId, dataType]);

		if (result.rows.length === 0) {
			return {
				success: true,
				anchor: undefined,
			};
		}

		return {
			success: true,
			anchor: {
				id: result.rows[0].id,
				data_type: result.rows[0].data_type,
				anchor_data: result.rows[0].anchor_data,
				last_sync_at: result.rows[0].last_sync_at,
			},
		};
	} catch (error) {
		console.error("Error getting sync anchor:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}
