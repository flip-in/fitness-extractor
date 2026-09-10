// Shared vocabulary for the GPS heatmap: activity groups, colours, and the
// tile-pixel grid the backend counts in (256px Web Mercator tiles).

export type ActivityGroup = "cycling" | "running" | "walking" | "other";

export const GROUPS: Record<
	ActivityGroup,
	{ label: string; icon: string; types: string[] | null; ramp: string[] }
> = {
	cycling: {
		label: "Cycling",
		icon: "🚴",
		types: ["Cycling"],
		// count 1 → few → many → hot
		ramp: ["#7a2e00", "#ff7a00", "#ffb340", "#ffe9b0"],
	},
	running: {
		label: "Running",
		icon: "🏃",
		types: ["Running"],
		ramp: ["#2a1f7a", "#6d5cff", "#a89dff", "#e6e2ff"],
	},
	walking: {
		label: "Walking",
		icon: "🚶",
		types: ["Walking", "Hiking"],
		ramp: ["#0f4a2a", "#22c55e", "#86efac", "#e8ffe8"],
	},
	other: {
		label: "Other",
		icon: "•",
		types: null, // everything not claimed above
		ramp: ["#444", "#9a9a9a", "#d0d0d0", "#f4f4f4"],
	},
};

export const GROUP_ORDER: ActivityGroup[] = [
	"other",
	"walking",
	"running",
	"cycling",
];

export function groupOf(workoutType: string): ActivityGroup {
	for (const g of GROUP_ORDER) {
		const types = GROUPS[g].types;
		if (types?.includes(workoutType)) return g;
	}
	return "other";
}

/** Zooms the backend stores; the map picks the finest that is still ≤ ~1 px per cell. */
export const STORED_ZOOMS = [13, 10, 7] as const;

export function storedZoomFor(mapZoom: number): number {
	// Mapbox uses 512px tiles, so a 256px-tile cell at zoom Z is 1 px at map zoom Z-1.
	if (mapZoom >= 11) return 13;
	if (mapZoom >= 8) return 10;
	return 7;
}

/** Centre lon/lat of tile-pixel cell (x, y) at `zoom`. */
export function cellCenter(
	x: number,
	y: number,
	zoom: number,
): [number, number] {
	const n = 256 * 2 ** zoom;
	const lon = ((x + 0.5) / n) * 360 - 180;
	const latR = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
	return [lon, (latR * 180) / Math.PI];
}
