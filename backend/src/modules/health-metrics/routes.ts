import express from "express";
import { requireApiKey } from "../../middleware/auth.js";
import { getHealthMetrics } from "./controller.js";

const router = express.Router();

// All health metrics routes require API key authentication
router.use(requireApiKey);

// Health metrics endpoints
router.get("/:metricType", getHealthMetrics);

export default router;
