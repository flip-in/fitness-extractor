/**
 * Activity groups for the GPS heatmap. heatmap_cells stores the raw HealthKit
 * workout type; tiles and the sidebar group them here, so this is the single
 * source of the mapping (the dashboard only knows group ids, labels, colours).
 */

export type ActivityGroup = "cycling" | "running" | "walking" | "other";

export const GROUP_TYPES: Record<Exclude<ActivityGroup, "other">, string[]> = {
	cycling: ["Cycling"],
	running: ["Running"],
	walking: ["Walking", "Hiking"],
};

export function groupOf(workoutType: string): ActivityGroup {
	for (const [group, types] of Object.entries(GROUP_TYPES)) {
		if (types.includes(workoutType)) return group as ActivityGroup;
	}
	return "other";
}

/**
 * SQL expression mapping `workout_type` to its group id. Appends the type and
 * group literals to `params` and references them by position.
 */
export function groupCaseSql(params: unknown[]): string {
	const whens: string[] = [];
	for (const [group, types] of Object.entries(GROUP_TYPES)) {
		for (const type of types) {
			params.push(type, group);
			whens.push(`WHEN $${params.length - 1} THEN $${params.length}::text`);
		}
	}
	return `CASE workout_type ${whens.join(" ")} ELSE 'other' END`;
}
