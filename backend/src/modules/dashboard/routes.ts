import express from "express";
import { requireApiKey } from "../../middleware/auth.js";
import {
	getFavoriteWorkoutList,
	getRecentDashboardData,
} from "./controller.js";

const router = express.Router();

// All dashboard routes require API key authentication
router.use(requireApiKey);

// Dashboard endpoints
router.get("/recent", getRecentDashboardData);
router.get("/favorites", getFavoriteWorkoutList);

export default router;
