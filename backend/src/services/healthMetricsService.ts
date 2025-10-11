import type { Pool, QueryResult } from "pg";

export interface HealthMetricData {
	healthkit_uuid: string;
	metric_type: string;
	value: number;
	unit: string;
	start_date: string;
	end_date: string;
	source_name?: string;
	source_bundle_id?: string;
	device_name?: string;
	metadata?: Record<string, unknown>;
}

export interface SyncResult {
	success: boolean;
	metricId?: string;
	error?: string;
}

/**
 * Insert a health metric into the database
 * Returns success: true if inserted, or error if duplicate/failed
 */
export async function insertHealthMetric(
	pool: Pool,
	userId: string,
	metric: HealthMetricData,
): Promise<SyncResult> {
	const client = await pool.connect();

	try {
		await client.query("BEGIN");

		const query = `
			INSERT INTO health_metrics (
				user_id, healthkit_uuid, metric_type, value, unit,
				start_date, end_date, source_name, source_bundle_id,
				device_name, metadata
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (healthkit_uuid) DO NOTHING
			RETURNING id
		`;

		const values = [
			userId,
			metric.healthkit_uuid,
			metric.metric_type,
			metric.value,
			metric.unit,
			metric.start_date,
			metric.end_date,
			metric.source_name || null,
			metric.source_bundle_id || null,
			metric.device_name || null,
			metric.metadata ? JSON.stringify(metric.metadata) : null,
		];

		const result: QueryResult = await client.query(query, values);

		// Check if metric was inserted (not a duplicate)
		if (result.rows.length === 0) {
			await client.query("ROLLBACK");
			return {
				success: false,
				error: "Duplicate metric",
			};
		}

		const metricId = result.rows[0].id;

		await client.query("COMMIT");

		return {
			success: true,
			metricId,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Error inserting health metric:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	} finally {
		client.release();
	}
}
