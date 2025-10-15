import { join } from "node:path";
import dotenv from "dotenv";

// Load environment variables first, before other imports
// Assume we're running from backend/ directory, so ../.env is project root
const envPath = join(process.cwd(), "../.env");
const result = dotenv.config({ path: envPath });

console.log("Loading .env from:", envPath);

if (result.error) {
	console.error("Error loading .env file:", result.error);
	process.exit(1);
}

// Validate required env vars
if (!process.env.DB_PASSWORD || !process.env.API_KEY) {
	console.error("ERROR: Required environment variables not set");
	console.error("DB_PASSWORD:", process.env.DB_PASSWORD ? "✓" : "✗");
	console.error("API_KEY:", process.env.API_KEY ? "✓" : "✗");
	process.exit(1);
}

import cors from "cors";
import express, { type Request, type Response } from "express";
import { getPool } from "./db/pool.js";
import activityRingsRoutes from "./routes/activityRings.js";
import dashboardRoutes from "./routes/dashboard.js";
import healthMetricsRoutes from "./routes/healthMetrics.js";
import syncRoutes from "./routes/sync.js";
import workoutRoutes from "./routes/workout.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "50mb" })); // Parse JSON bodies, limit to 50MB for GPS routes

// Routes
app.use("/api/sync", syncRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/workout", workoutRoutes);
app.use("/api/activity-rings", activityRingsRoutes);
app.use("/api/health-metrics", healthMetricsRoutes);

// Health check endpoint (no auth required)
app.get("/api/health", async (_req: Request, res: Response) => {
	try {
		// Test database connection
		const pool = getPool();
		const result = await pool.query("SELECT NOW()");
		res.json({
			status: "ok",
			timestamp: result.rows[0].now,
			database: "connected",
		});
	} catch (error) {
		console.error("Health check failed:", error);
		res.status(503).json({
			status: "error",
			message: "Database connection failed",
		});
	}
});

// Start server
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
	console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
	console.log(
		`CORS origin: ${process.env.CORS_ORIGIN || "http://localhost:5173"}`,
	);
});

// Graceful shutdown
process.on("SIGTERM", () => {
	console.log("SIGTERM signal received: closing HTTP server");
	const pool = getPool();
	pool.end(() => {
		console.log("Database pool closed");
		process.exit(0);
	});
});
