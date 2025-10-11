import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Get or create the database connection pool
 * Lazy initialization ensures env vars are loaded first
 */
export function getPool(): pg.Pool {
	if (!pool) {
		pool = new Pool({
			user: "postgres",
			host: process.env.NODE_ENV === "production" ? "db" : "localhost",
			database: "fitness",
			password: process.env.DB_PASSWORD,
			port: 5432,
			// Connection pool settings
			max: 20, // Maximum number of clients in the pool
			idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
			connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection cannot be established
		});

		// Test connection on startup
		pool.on("connect", () => {
			console.log("Database connected");
		});

		pool.on("error", (err) => {
			console.error("Unexpected error on idle client", err);
			process.exit(-1);
		});
	}

	return pool;
}
