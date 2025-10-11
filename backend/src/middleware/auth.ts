import type { NextFunction, Request, Response } from "express";

/**
 * Middleware to verify API key authentication
 * Expects API key in X-API-Key header
 */
export const requireApiKey = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	const API_KEY = process.env.API_KEY;

	// This should never happen if env vars are loaded correctly in index.ts
	if (!API_KEY) {
		console.error("CRITICAL: API_KEY is not set in environment variables");
		res.status(500).json({
			error: "Server configuration error",
			message: "API key not configured",
		});
		return;
	}

	const providedKey = req.headers["x-api-key"];

	if (!providedKey) {
		res.status(401).json({
			error: "Unauthorized",
			message: "API key is required. Include X-API-Key header.",
		});
		return;
	}

	if (providedKey !== API_KEY) {
		res.status(403).json({
			error: "Forbidden",
			message: "Invalid API key",
		});
		return;
	}

	// API key is valid, proceed to next middleware
	next();
};
