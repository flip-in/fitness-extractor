import dotenv from "dotenv";

// Load environment variables first, before other imports
const result = dotenv.config({ path: "../.env" });

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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" })); // Parse JSON bodies, limit to 10MB for GPS routes

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
