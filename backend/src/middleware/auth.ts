import type { NextFunction, Request, Response } from "express";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
	console.error("ERROR: API_KEY is not set in environment variables");
	process.exit(1);
}

/**
 * Middleware to verify API key authentication
 * Expects API key in X-API-Key header
 */
export const requireApiKey = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
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
