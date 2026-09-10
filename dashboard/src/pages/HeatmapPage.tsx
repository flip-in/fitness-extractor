import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { HeatmapMap } from "../components/HeatmapMap";
import { type ActivityGroup, GROUP_ORDER, GROUPS, groupOf } from "../heatmap";
import type { HeatmapWorkout, WorkoutRoute } from "../types";

// Amsterdam; used until geolocation or the newest route says otherwise.
const FALLBACK_CENTER: [number, number] = [4.9041, 52.3676];

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function HeatmapPage() {
	const [workouts, setWorkouts] = useState<HeatmapWorkout[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [visible, setVisible] = useState<Record<ActivityGroup, boolean>>({
		cycling: true,
		running: true,
		walking: true,
		other: true,
	});
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedRoute, setSelectedRoute] = useState<WorkoutRoute | null>(null);
	const [truncated, setTruncated] = useState(false);
	// The map mounts once we know where to start, so the first tiles are useful.
	const [start, setStart] = useState<{
		center: [number, number];
		zoom: number;
	} | null>(null);

	useEffect(() => {
		api
			.getHeatmapWorkouts()
			.then(setWorkouts)
			.catch((err) =>
				setError(err instanceof Error ? err.message : "Failed to load"),
			);
	}, []);

	// Pick a start position once the list has loaded (or failed: the map must
	// still appear so the error is not the whole page).
	useEffect(() => {
		if (start || (workouts === null && !error)) return;
		const newest = workouts?.[0];
		const fromRoutes: [number, number] | null = newest
			? [
					(newest.bounds.min_lon + newest.bounds.max_lon) / 2,
					(newest.bounds.min_lat + newest.bounds.max_lat) / 2,
				]
			: null;
		if (!navigator.geolocation) {
			setStart({ center: fromRoutes ?? FALLBACK_CENTER, zoom: 11 });
			return;
		}
		let settled = false;
		const settle = (center: [number, number]) => {
			if (settled) return;
			settled = true;
			setStart({ center, zoom: 11 });
		};
		navigator.geolocation.getCurrentPosition(
			(pos) => settle([pos.coords.longitude, pos.coords.latitude]),
			() => settle(fromRoutes ?? FALLBACK_CENTER),
			{ timeout: 4000, maximumAge: 600_000 },
		);
		// Don't hold the map hostage to a slow permission prompt.
		const t = setTimeout(() => settle(fromRoutes ?? FALLBACK_CENTER), 4500);
		return () => clearTimeout(t);
	}, [start, workouts, error]);

	const selectWorkout = async (w: HeatmapWorkout) => {
		if (w.id === selectedId) {
			setSelectedId(null);
			setSelectedRoute(null);
			return;
		}
		setSelectedId(w.id);
		try {
			setSelectedRoute(await api.getWorkoutRoute(w.id));
		} catch (err) {
			console.error("Failed to load route:", err);
			setSelectedRoute(null);
		}
	};

	const toggle = (g: ActivityGroup) =>
		setVisible((v) => ({ ...v, [g]: !v[g] }));

	const onTruncated = useCallback((t: boolean) => setTruncated(t), []);

	const listed = (workouts ?? []).filter(
		(w) => visible[groupOf(w.workout_type)],
	);

	return (
		<div className="h-screen w-screen flex bg-gray-950 text-gray-100 overflow-hidden">
			<div className="flex-1 relative flex">
				{start ? (
					<HeatmapMap
						initialCenter={start.center}
						initialZoom={start.zoom}
						visible={visible}
						selectedRoute={selectedRoute}
						onTruncated={onTruncated}
					/>
				) : (
					<div className="flex-1 flex items-center justify-center text-gray-400">
						Locating…
					</div>
				)}
				{truncated && (
					<div className="absolute bottom-3 left-3 text-xs bg-black/70 px-2 py-1 rounded">
						Too many cells for this view; zoom in for full detail.
					</div>
				)}
			</div>

			<aside className="w-80 shrink-0 flex flex-col border-l border-gray-800 bg-gray-900">
				<div className="p-4 border-b border-gray-800">
					<div className="flex items-baseline justify-between">
						<h1 className="text-lg font-semibold">Heatmap</h1>
						<Link to="/" className="text-sm text-blue-400 hover:underline">
							← Dashboard
						</Link>
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						{[...GROUP_ORDER].reverse().map((g) => (
							<button
								type="button"
								key={g}
								onClick={() => toggle(g)}
								className={`text-xs px-2 py-1 rounded-full border transition ${
									visible[g]
										? "border-transparent text-gray-950"
										: "border-gray-600 text-gray-400"
								}`}
								style={
									visible[g]
										? { backgroundColor: GROUPS[g].ramp[1] }
										: undefined
								}
							>
								{GROUPS[g].icon} {GROUPS[g].label}
							</button>
						))}
					</div>
				</div>

				<div className="flex-1 overflow-y-auto">
					{error && <p className="p-4 text-red-400 text-sm">{error}</p>}
					{workouts === null && !error && (
						<p className="p-4 text-gray-400 text-sm">Loading…</p>
					)}
					{listed.map((w) => {
						const g = groupOf(w.workout_type);
						const active = w.id === selectedId;
						return (
							<button
								type="button"
								key={w.id}
								onClick={() => selectWorkout(w)}
								className={`w-full text-left px-4 py-2.5 border-b border-gray-800/60 hover:bg-gray-800 transition ${
									active ? "bg-gray-800" : ""
								}`}
							>
								<div className="flex items-center gap-2 text-sm">
									<span>{GROUPS[g].icon}</span>
									<span className="font-medium">{w.workout_type}</span>
									{w.is_favorite && <span className="text-pink-400">♥</span>}
									<span className="ml-auto text-gray-400 text-xs">
										{formatDate(w.start_date)}
									</span>
								</div>
								<div className="text-xs text-gray-400 mt-0.5">
									{w.total_distance_meters != null
										? `${(w.total_distance_meters / 1000).toFixed(1)} km · `
										: ""}
									{formatDuration(w.duration_seconds)}
								</div>
							</button>
						);
					})}
					{workouts !== null && listed.length === 0 && !error && (
						<p className="p-4 text-gray-400 text-sm">No routes to show.</p>
					)}
				</div>
			</aside>
		</div>
	);
}
