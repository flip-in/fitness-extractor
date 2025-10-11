import express from "express";
import {
	getWorkoutDetails,
	getWorkoutRouteData,
} from "../controllers/dashboardController.js";
import { requireApiKey } from "../middleware/auth.js";

const router = express.Router();

// All workout routes require API key authentication
router.use(requireApiKey);

// Workout endpoints
router.get("/:id", getWorkoutDetails);
router.get("/:id/route", getWorkoutRouteData);

export default router;
