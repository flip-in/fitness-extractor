import { existsSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";

// Load environment variables first, before other imports.
// Local dev: run from backend/, so ../.env is the repo root. In the container
// there is no .env file — compose injects the environment — so its absence is fine.
const envPath = join(process.cwd(), "../.env");
if (existsSync(envPath)) {
	console.log("Loading .env from:", envPath);
	dotenv.config({ path: envPath });
} else {
	console.log("No .env file; using process environment");
}

// Validate required env vars
if (!process.env.DB_PASSWORD || !process.env.API_KEY) {
	console.error("ERROR: Required environment variables not set");
	console.error("DB_PASSWORD:", process.env.DB_PASSWORD ? "✓" : "✗");
	console.error("API_KEY:", process.env.API_KEY ? "✓" : "✗");
	process.exit(1);
}

import cors from "cors";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { getPool } from "./db/pool.js";
import activityRingsRoutes from "./routes/activityRings.js";
import dashboardRoutes from "./routes/dashboard.js";
import healthMetricsRoutes from "./routes/healthMetrics.js";
import heatmapRoutes from "./routes/heatmap.js";
import syncRoutes from "./routes/sync.js";
import workoutRoutes from "./routes/workout.js";
import { startRebuild } from "./services/heatmapService.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));

// Request logging. Sits before the body parser so oversized payloads are still
// logged with their size when express.json rejects them with a 413.
// Successful health checks are skipped: the compose healthcheck polls
// /api/health every 30s and would be most of the log. Failures still log.
app.use((req: Request, res: Response, next: NextFunction) => {
	const bytes = Number(req.headers["content-length"] ?? 0);
	const size = bytes > 0 ? ` ${(bytes / 1024 / 1024).toFixed(2)}MB` : "";
	const started = Date.now();
	res.on("finish", () => {
		if (req.path === "/api/health" && res.statusCode === 200) return;
		console.log(
			`${req.method} ${req.originalUrl} → ${res.statusCode}${size} ${Date.now() - started}ms`,
		);
	});
	next();
});

app.use(express.json({ limit: "50mb" })); // Parse JSON bodies, limit to 50MB for GPS routes

// Routes
app.use("/api/sync", syncRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/workout", workoutRoutes);
app.use("/api/activity-rings", activityRingsRoutes);
app.use("/api/health-metrics", healthMetricsRoutes);
app.use("/api/heatmap", heatmapRoutes);

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

// Unknown /api/* paths must 404 as JSON. Without this the SPA fallback below
// would answer them with index.html.
app.use("/api", (_req: Request, res: Response) => {
	res.status(404).json({ error: "Not Found" });
});

// Dashboard: in production the same process serves the Vite build, so the
// browser talks to the API same-origin and CORS never enters the picture.
// Set STATIC_DIR to the build directory; unset (local dev) serves nothing.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
	app.use(express.static(staticDir));
	// Express 5 / path-to-regexp v8: the catch-all is a named wildcard, not "*".
	app.get("/*splat", (_req: Request, res: Response) => {
		res.sendFile(join(staticDir, "index.html"));
	});
	console.log(`Serving dashboard from ${staticDir}`);
}

// Start server
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
	console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
	console.log(
		`CORS origin: ${process.env.CORS_ORIGIN || "http://localhost:5173"}`,
	);
	// Count any route the heatmap missed (crash between a sync's COMMIT and its
	// rasterisation, or a fresh deployment). Runs in the background.
	startRebuild(getPool(), "reconcile");
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
