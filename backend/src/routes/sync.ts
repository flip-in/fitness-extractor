import express from "express";
import { syncWorkouts } from "../controllers/syncController.js";
import { requireApiKey } from "../middleware/auth.js";

const router = express.Router();

// All sync routes require API key authentication
router.use(requireApiKey);

// Sync endpoints
router.post("/workouts", syncWorkouts);
// TODO: Add other sync endpoints
// router.post("/health-metrics", syncHealthMetrics);
// router.post("/activity-rings", syncActivityRings);
// router.post("/anchors", syncAnchors);
// router.get("/anchors/:userId/:dataType", getAnchor);

export default router;
