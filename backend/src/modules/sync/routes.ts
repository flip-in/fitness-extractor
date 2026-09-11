import express from "express";
import { requireApiKey } from "../../middleware/auth.js";
import { syncActivityRings } from "../activity-rings/controller.js";
import { syncHealthMetrics } from "../health-metrics/controller.js";
import { syncWorkouts } from "../workouts/controller.js";
import { getAnchor, updateSyncAnchors } from "./controller.js";

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
