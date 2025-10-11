import express from "express";
import { getActivityRingsByDateHandler } from "../controllers/dashboardController.js";
import { requireApiKey } from "../middleware/auth.js";

const router = express.Router();

// All activity rings routes require API key authentication
router.use(requireApiKey);

// Activity rings endpoints
router.get("/:date", getActivityRingsByDateHandler);

export default router;
