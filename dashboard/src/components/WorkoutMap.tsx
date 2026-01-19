import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { WorkoutRoute } from "../types";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface WorkoutMapProps {
  route: WorkoutRoute;
}

export function WorkoutMap({ route }: WorkoutMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN) return;

    // Initialize map
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [
        (route.bounding_box.min_lon + route.bounding_box.max_lon) / 2,
        (route.bounding_box.min_lat + route.bounding_box.max_lat) / 2,
      ],
      zoom: 13,
    });

    map.current.on("load", () => {
      if (!map.current) return;

      // Create GeoJSON from route data
      const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: route.route_data.map((point) => [
            point.longitude,
            point.latitude,
          ]),
        },
      };

      // Add route line
      map.current.addSource("route", {
        type: "geojson",
        data: geojson,
      });

      map.current.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ff3b30",
          "line-width": 4,
        },
      });

      // Add start marker
      if (route.route_data.length > 0) {
        const start = route.route_data[0];
        new mapboxgl.Marker({ color: "#00ff00" })
          .setLngLat([start.longitude, start.latitude])
          .setPopup(new mapboxgl.Popup().setHTML("<p>Start</p>"))
          .addTo(map.current);

        // Add end marker
        const end = route.route_data[route.route_data.length - 1];
        new mapboxgl.Marker({ color: "#ff0000" })
          .setLngLat([end.longitude, end.latitude])
          .setPopup(new mapboxgl.Popup().setHTML("<p>End</p>"))
          .addTo(map.current);
      }

      // Fit map to route bounds
      const bounds = new mapboxgl.LngLatBounds([
        [route.bounding_box.min_lon, route.bounding_box.min_lat],
        [route.bounding_box.max_lon, route.bounding_box.max_lat],
      ]);
      map.current.fitBounds(bounds, { padding: 50 });
    });

    return () => {
      map.current?.remove();
    };
  }, [route]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="w-full h-96 bg-gray-100 dark:bg-gray-800 rounded-lg flex flex-col items-center justify-center p-6 text-center">
        <div className="text-gray-700 dark:text-gray-300">
          <p className="mb-2">Mapbox token not configured.</p>
          <p className="text-sm">
            Please set VITE_MAPBOX_TOKEN in your .env file.
          </p>
          <p className="text-sm mt-2">
            Get a token from:{" "}
            <a
              href="https://account.mapbox.com/access-tokens/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              https://account.mapbox.com/access-tokens/
            </a>
          </p>
        </div>
      </div>
    );
  }

  return <div ref={mapContainer} className="w-full h-96 rounded-lg" />;
}
