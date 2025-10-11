import express from "express";
import { getRecentDashboardData } from "../controllers/dashboardController.js";
import { requireApiKey } from "../middleware/auth.js";

const router = express.Router();

// All dashboard routes require API key authentication
router.use(requireApiKey);

// Dashboard endpoints
router.get("/recent", getRecentDashboardData);

export default router;
