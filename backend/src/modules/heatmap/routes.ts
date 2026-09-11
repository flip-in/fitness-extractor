import express from "express";
import { requireApiKey } from "../../middleware/auth.js";
import {
	getHeatmapCells,
	getHeatmapStatus,
	getHeatmapTile,
	getHeatmapWorkouts,
	rebuildHeatmap,
	reconcileHeatmap,
} from "./controller.js";

const router = express.Router();

router.use(requireApiKey);

router.get("/cells", getHeatmapCells);
router.get("/tiles/:z/:x/:y.mvt", getHeatmapTile);
router.get("/workouts", getHeatmapWorkouts);
router.get("/status", getHeatmapStatus);
router.post("/rebuild", rebuildHeatmap);
router.post("/reconcile", reconcileHeatmap);

export default router;
