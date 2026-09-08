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

export interface BulkSyncResult {
	synced: number;
	skipped: number;
	errors: Array<{ healthkit_uuid: string; error: string }>;
}

/** Rows per multi-row INSERT: 11 params each, well under pg's 65535 cap. */
const BULK_CHUNK = 1000;
const COLUMNS_PER_ROW = 11;

/**
 * Insert many health metrics with a multi-row INSERT ... ON CONFLICT DO NOTHING
 * per chunk. One row at a time (connect/BEGIN/INSERT/COMMIT each) took >30s for a
 * 5000-row page over the NAS and the phone's request timed out (2026-09-08), so
 * its anchor never advanced. A chunk that fails as a whole (bad row) falls back to
 * the per-row path so the caller still gets per-row errors for HTTP 207.
 */
export async function insertHealthMetrics(
	pool: Pool,
	userId: string,
	metrics: HealthMetricData[],
): Promise<BulkSyncResult> {
	const result: BulkSyncResult = { synced: 0, skipped: 0, errors: [] };

	for (let i = 0; i < metrics.length; i += BULK_CHUNK) {
		const chunk = metrics.slice(i, i + BULK_CHUNK);
		try {
			const inserted = await insertChunk(pool, userId, chunk);
			result.synced += inserted;
			result.skipped += chunk.length - inserted;
		} catch (error) {
			console.error(
				`Bulk metric insert failed for ${chunk.length} rows, retrying row by row:`,
				error instanceof Error ? error.message : error,
			);
			for (const metric of chunk) {
				const single = await insertHealthMetric(pool, userId, metric);
				if (single.success) {
					result.synced++;
				} else if (single.error === "Duplicate metric") {
					result.skipped++;
				} else {
					result.errors.push({
						healthkit_uuid: metric.healthkit_uuid,
						error: single.error || "Unknown error",
					});
				}
			}
		}
	}

	return result;
}

/** Returns the number of rows actually inserted (duplicates are skipped). */
async function insertChunk(
	pool: Pool,
	userId: string,
	chunk: HealthMetricData[],
): Promise<number> {
	const values: unknown[] = [];
	const rows = chunk.map((metric, index) => {
		const base = index * COLUMNS_PER_ROW;
		values.push(
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
		);
		const placeholders = Array.from(
			{ length: COLUMNS_PER_ROW },
			(_, column) => `$${base + column + 1}`,
		);
		return `(${placeholders.join(", ")})`;
	});

	const query = `
		INSERT INTO health_metrics (
			user_id, healthkit_uuid, metric_type, value, unit,
			start_date, end_date, source_name, source_bundle_id,
			device_name, metadata
		) VALUES ${rows.join(",\n")}
		ON CONFLICT (healthkit_uuid) DO NOTHING
	`;

	const result: QueryResult = await pool.query(query, values);
	return result.rowCount ?? 0;
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
