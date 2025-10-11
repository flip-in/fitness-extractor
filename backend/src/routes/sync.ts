import express from "express";
import {
	getAnchor,
	syncActivityRings,
	syncHealthMetrics,
	syncWorkouts,
	updateSyncAnchors,
} from "../controllers/syncController.js";
import { requireApiKey } from "../middleware/auth.js";

const router = express.Router();

// All sync routes require API key authentication
router.use(requireApiKey);

// Sync endpoints
router.post("/workouts", syncWorkouts);
router.post("/health-metrics", syncHealthMetrics);
router.post("/activity-rings", syncActivityRings);
router.post("/anchors", updateSyncAnchors);
router.get("/anchors/:userId/:dataType", getAnchor);

export default router;
