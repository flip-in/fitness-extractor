import type { Feature, LineString } from "geojson";
import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, API_KEY, api } from "../api";
import { type ActivityGroup, GROUP_ORDER, GROUPS } from "../heatmap";
import type { WorkoutRoute } from "../types";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface HeatmapMapProps {
	initialCenter: [number, number];
	initialZoom: number;
	visible: Record<ActivityGroup, boolean>;
	selectedRoute: WorkoutRoute | null;
	/** Called with [west, south, east, north] once loaded and after every settled move. */
	onViewChange?: (bbox: [number, number, number, number]) => void;
}

/**
 * Cells arrive as vector tiles from the backend (one MVT layer per group),
 * so Mapbox owns fetching, caching, and the tile buffer at the edges. Tiles
 * exist up to zoom 14 (the base grid, ~6 m cells) and are overzoomed beyond.
 */
const HEAT_SOURCE = "heat";
const TILE_MAX_ZOOM = 14;
const layerId = (g: ActivityGroup) => `heat-${g}`;
const apiOrigin = API_BASE_URL || window.location.origin;

function tileUrl(version: string): string {
	return `${apiOrigin}/api/heatmap/tiles/{z}/{x}/{y}.mvt?v=${encodeURIComponent(version)}`;
}

/**
 * Cell radius in px. Tiles at zoom ≥ 10 carry the z14 cells (256px-tile
 * pixels), which are 2^(mapZoom + 1 - 14) px wide on Mapbox's 512px tiles.
 * Radius is 0.8× that (with a soft edge, adjacent cells merge into a stroke
 * rather than a bead chain): 1.6 px at zoom 14, doubling per zoom. Below the
 * 1.1 px floor (zoom < ~13.5) the curve is flat.
 */
const RADIUS: mapboxgl.Expression = [
	"interpolate",
	["exponential", 2],
	["zoom"],
	13.4,
	1.1,
	14,
	0.8 * 2,
	22,
	0.8 * 2 ** 9,
];
const BLUR = 0.35;

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
	onViewChange,
}: HeatmapMapProps) {
	const container = useRef<HTMLDivElement>(null);
	const map = useRef<mapboxgl.Map | null>(null);
	const [ready, setReady] = useState(false);

	// Create the map once. initialCenter/zoom are only read on mount.
	useEffect(() => {
		if (!container.current || !MAPBOX_TOKEN) return;
		mapboxgl.accessToken = MAPBOX_TOKEN;
		let disposed = false;
		const m = new mapboxgl.Map({
			container: container.current,
			style: "mapbox://styles/mapbox/dark-v11",
			center: initialCenter,
			zoom: initialZoom,
			// Tile requests go to our API, which wants the key as a header.
			transformRequest: (url) =>
				API_KEY && url.startsWith(`${apiOrigin}/api/`)
					? { url, headers: { "X-API-Key": API_KEY } }
					: { url },
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
		if (import.meta.env.DEV) {
			// Dev console handle: window.__heatmap.getSource("heat") etc.
			(window as unknown as { __heatmap?: mapboxgl.Map }).__heatmap = m;
			m.on("error", (e) => console.error("[heatmap] map error:", e.error));
		}

		m.on("load", async () => {
			// The heatmap version keys the tile URLs: cached for a year, a recount
			// (new route, rebuild) changes the URL. Fall back to a per-load key.
			const version = await api
				.getHeatmapStatus()
				.then((s) => s.version)
				.catch(() => String(Date.now()));
			if (disposed) return;
			m.addSource(HEAT_SOURCE, {
				type: "vector",
				tiles: [tileUrl(version)],
				minzoom: 0,
				maxzoom: TILE_MAX_ZOOM,
			});
			for (const g of GROUP_ORDER) {
				m.addLayer({
					id: layerId(g),
					type: "circle",
					source: HEAT_SOURCE,
					"source-layer": g,
					paint: {
						"circle-radius": RADIUS,
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
						"circle-blur": BLUR,
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
			disposed = true;
			m.remove();
			map.current = null;
			setReady(false);
		};
	}, []);

	// Report the viewport so the sidebar can follow it.
	useEffect(() => {
		const m = map.current;
		if (!m || !ready || !onViewChange) return;
		const report = () => {
			const b = m.getBounds();
			if (b)
				onViewChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
		};
		m.on("moveend", report);
		report();
		return () => {
			m.off("moveend", report);
		};
	}, [ready, onViewChange]);

	// Group toggles.
	useEffect(() => {
		const m = map.current;
		if (!m || !ready) return;
		for (const g of GROUP_ORDER) {
			m.setLayoutProperty(
				layerId(g),
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
