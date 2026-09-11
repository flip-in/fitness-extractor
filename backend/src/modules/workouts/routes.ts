import express from "express";
import { requireApiKey } from "../../middleware/auth.js";
import {
	getWorkoutDetails,
	getWorkoutRouteData,
	setWorkoutFavoriteFlag,
} from "./controller.js";

const router = express.Router();

// All workout routes require API key authentication
router.use(requireApiKey);

// Workout endpoints
router.get("/:id", getWorkoutDetails);
router.get("/:id/route", getWorkoutRouteData);
router.put("/:id/favorite", setWorkoutFavoriteFlag);

export default router;
