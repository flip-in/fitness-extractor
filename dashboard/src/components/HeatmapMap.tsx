import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
	type ActivityGroup,
	cellCenter,
	GROUP_ORDER,
	GROUPS,
	groupOf,
	storedZoomFor,
} from "../heatmap";
import type { WorkoutRoute } from "../types";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface HeatmapMapProps {
	initialCenter: [number, number];
	initialZoom: number;
	visible: Record<ActivityGroup, boolean>;
	selectedRoute: WorkoutRoute | null;
	onTruncated?: (truncated: boolean) => void;
}

const EMPTY: FeatureCollection<Point> = {
	type: "FeatureCollection",
	features: [],
};
const sourceId = (g: ActivityGroup) => `heat-${g}`;
/** Packs a cell (x, y) into one number; x, y < 2^21 at the finest stored zoom. */
const CELL_KEY = 2 ** 22;

/**
 * Cell radius in px so a cell drawn at stored zoom Z covers its own footprint
 * with a little overlap: a 256px-tile cell is 2^(mapZoom + 1 - Z) px wide.
 * Exponential base-2 interpolation between two stops is exactly that curve.
 */
function radiusExpression(storedZoom: number): mapboxgl.Expression {
	// ["zoom"] is only allowed as the direct input of a top-level interpolate,
	// so the 1.1 px floor is baked into per-zoom stops instead of a "max".
	const px = (mapZoom: number) =>
		Math.max(1.1, 0.62 * 2 ** (mapZoom + 1 - storedZoom));
	const stops: number[] = [];
	for (let z = storedZoom - 4; z <= storedZoom + 8; z++) stops.push(z, px(z));
	return ["interpolate", ["linear"], ["zoom"], ...stops];
}

// Roughly logarithmic stops: the home streets reach counts in the hundreds
// (max 452 on 2026-09-10), a one-off holiday ride is 1.
function colorExpression(ramp: string[]): mapboxgl.Expression {
	return [
		"interpolate",
		["linear"],
		["get", "c"],
		1,
		ramp[0],
		5,
		ramp[1],
		25,
		ramp[2],
		120,
		ramp[3],
	];
}

export function HeatmapMap({
	initialCenter,
	initialZoom,
	visible,
	selectedRoute,
	onTruncated,
}: HeatmapMapProps) {
	const container = useRef<HTMLDivElement>(null);
	const map = useRef<mapboxgl.Map | null>(null);
	const [ready, setReady] = useState(false);
	const currentStoredZoom = useRef<number>(0);
	const fetchSeq = useRef(0);

	// Create the map once. initialCenter/zoom are only read on mount.
	useEffect(() => {
		if (!container.current || !MAPBOX_TOKEN) return;
		mapboxgl.accessToken = MAPBOX_TOKEN;
		const m = new mapboxgl.Map({
			container: container.current,
			style: "mapbox://styles/mapbox/dark-v11",
			center: initialCenter,
			zoom: initialZoom,
		});
		m.addControl(
			new mapboxgl.NavigationControl({ showCompass: false }),
			"top-left",
		);
		m.addControl(
			new mapboxgl.GeolocateControl({ showUserLocation: true }),
			"top-left",
		);
		map.current = m;

		m.on("load", () => {
			for (const g of GROUP_ORDER) {
				m.addSource(sourceId(g), { type: "geojson", data: EMPTY });
				m.addLayer({
					id: sourceId(g),
					type: "circle",
					source: sourceId(g),
					paint: {
						"circle-radius": radiusExpression(13),
						"circle-color": colorExpression(GROUPS[g].ramp),
						"circle-opacity": [
							"interpolate",
							["linear"],
							["get", "c"],
							1,
							0.55,
							6,
							0.95,
						],
						"circle-blur": 0.15,
					},
				});
			}
			m.addSource("selected-route", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			m.addLayer({
				id: "selected-route",
				type: "line",
				source: "selected-route",
				layout: { "line-join": "round", "line-cap": "round" },
				paint: {
					"line-color": "#ffffff",
					"line-width": 3,
					"line-opacity": 0.95,
				},
			});
			setReady(true);
		});

		return () => {
			m.remove();
			map.current = null;
			setReady(false);
		};
	}, []);

	// Fetch cells for the viewport on every settled move, debounced.
	useEffect(() => {
		const m = map.current;
		if (!m || !ready) return;

		let timer: ReturnType<typeof setTimeout> | null = null;
		const load = async () => {
			const seq = ++fetchSeq.current;
			const z = storedZoomFor(m.getZoom());
			const b = m.getBounds();
			if (!b) return;
			const bbox: [number, number, number, number] = [
				Math.max(-180, b.getWest()),
				Math.max(-85, b.getSouth()),
				Math.min(180, b.getEast()),
				Math.min(85, b.getNorth()),
			];
			try {
				const data = await api.getHeatmapCells(z, bbox);
				if (seq !== fetchSeq.current || !map.current) return; // stale
				if (z !== currentStoredZoom.current) {
					currentStoredZoom.current = z;
					for (const g of GROUP_ORDER) {
						m.setPaintProperty(
							sourceId(g),
							"circle-radius",
							radiusExpression(z),
						);
					}
				}
				// Sum counts per (group, cell): two raw types in one group (Walking
				// and Hiking) may both have a row for the same cell.
				const perGroup: Record<ActivityGroup, Map<number, number>> = {
					cycling: new Map(),
					running: new Map(),
					walking: new Map(),
					other: new Map(),
				};
				for (const [type, flat] of Object.entries(data.cells)) {
					const bucket = perGroup[groupOf(type)];
					for (let i = 0; i < flat.length; i += 3) {
						const key = flat[i] * CELL_KEY + flat[i + 1];
						bucket.set(key, (bucket.get(key) ?? 0) + flat[i + 2]);
					}
				}
				for (const g of GROUP_ORDER) {
					const features: Feature<Point>[] = [];
					for (const [key, c] of perGroup[g]) {
						features.push({
							type: "Feature",
							properties: { c },
							geometry: {
								type: "Point",
								coordinates: cellCenter(
									Math.floor(key / CELL_KEY),
									key % CELL_KEY,
									z,
								),
							},
						});
					}
					const src = m.getSource(sourceId(g)) as
						| mapboxgl.GeoJSONSource
						| undefined;
					src?.setData({ type: "FeatureCollection", features });
				}
				onTruncated?.(data.truncated);
			} catch (err) {
				console.error("Failed to load heatmap cells:", err);
			}
		};
		const schedule = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(load, 200);
		};

		m.on("moveend", schedule);
		load();
		return () => {
			m.off("moveend", schedule);
			if (timer) clearTimeout(timer);
		};
	}, [ready, onTruncated]);

	// Group toggles.
	useEffect(() => {
		const m = map.current;
		if (!m || !ready) return;
		for (const g of GROUP_ORDER) {
			m.setLayoutProperty(
				sourceId(g),
				"visibility",
				visible[g] ? "visible" : "none",
			);
		}
	}, [ready, visible]);

	// Selected route highlight + fly to it.
	useEffect(() => {
		const m = map.current;
		if (!m || !ready) return;
		const src = m.getSource("selected-route") as
			| mapboxgl.GeoJSONSource
			| undefined;
		if (!src) return;
		if (!selectedRoute || selectedRoute.route_data.length === 0) {
			src.setData({ type: "FeatureCollection", features: [] });
			return;
		}
		const line: Feature<LineString> = {
			type: "Feature",
			properties: {},
			geometry: {
				type: "LineString",
				coordinates: selectedRoute.route_data.map((p) => [
					p.longitude,
					p.latitude,
				]),
			},
		};
		src.setData(line);
		const bb = selectedRoute.bounding_box;
		m.fitBounds(
			[
				[bb.min_lon, bb.min_lat],
				[bb.max_lon, bb.max_lat],
			],
			{ padding: 60, duration: 900, maxZoom: 15 },
		);
	}, [ready, selectedRoute]);

	if (!MAPBOX_TOKEN) {
		return (
			<div className="flex-1 flex items-center justify-center text-gray-300">
				Mapbox token not configured (VITE_MAPBOX_TOKEN).
			</div>
		);
	}

	return <div ref={container} className="flex-1 h-full" />;
}
