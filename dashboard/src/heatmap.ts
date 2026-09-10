// Presentation of the GPS heatmap's activity groups. Which raw workout types
// belong to a group is the backend's call (heatmapGroups.ts): tiles arrive
// with one layer per group and /heatmap/workouts carries each workout's group.

import type { ActivityGroup } from "./types";

export type { ActivityGroup };

export const GROUPS: Record<
	ActivityGroup,
	{ label: string; icon: string; ramp: string[] }
> = {
	cycling: {
		label: "Cycling",
		icon: "🚴",
		// count 1 → few → many → hot
		ramp: ["#7a2e00", "#ff7a00", "#ffb340", "#ffe9b0"],
	},
	running: {
		label: "Running",
		icon: "🏃",
		ramp: ["#2a1f7a", "#6d5cff", "#a89dff", "#e6e2ff"],
	},
	walking: {
		label: "Walking",
		icon: "🚶",
		ramp: ["#0f4a2a", "#22c55e", "#86efac", "#e8ffe8"],
	},
	other: {
		label: "Other",
		icon: "•",
		ramp: ["#444", "#9a9a9a", "#d0d0d0", "#f4f4f4"],
	},
};

export const GROUP_ORDER: ActivityGroup[] = [
	"other",
	"walking",
	"running",
	"cycling",
];
