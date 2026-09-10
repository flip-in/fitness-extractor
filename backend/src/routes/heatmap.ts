import express from "express";
import {
	getHeatmapCells,
	getHeatmapStatus,
	getHeatmapWorkouts,
	rebuildHeatmap,
	reconcileHeatmap,
} from "../controllers/heatmapController.js";
import { requireApiKey } from "../middleware/auth.js";

const router = express.Router();

router.use(requireApiKey);

router.get("/cells", getHeatmapCells);
router.get("/workouts", getHeatmapWorkouts);
router.get("/status", getHeatmapStatus);
router.post("/rebuild", rebuildHeatmap);
router.post("/reconcile", reconcileHeatmap);

export default router;
