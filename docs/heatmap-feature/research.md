# Heatmap Feature Research

## Goal
Full-screen world map centered on user's location showing all GPS-enabled workouts as a heatmap. Split-panel layout with workout list for navigation.

---

## User Experience Vision

### Layout
```
┌─────────────────────────────────────┬──────────────────┐
│                                     │  Recent Workouts │
│                                     │  ──────────────  │
│           FULL-SCREEN MAP           │  🚴 Cycling 12km │
│        (heatmap + routes)           │  🏃 Run 5km      │
│                                     │  🚴 Cycling 8km  │
│     [user location marker]          │  ...             │
│                                     │                  │
└─────────────────────────────────────┴──────────────────┘
```

### Behavior
1. **Initial Load**: Map centers on browser geolocation (fallback: Amsterdam or last workout)
2. **Heatmap Layer**: All GPS workouts rendered as density heatmap, color-coded by activity type
3. **Workout List**: Scrollable sidebar with recent workouts (has_route = true only)
4. **Click Workout**: Map pans/zooms to workout bounds, highlights that route as a line overlay
5. **Explore**: User can pan/zoom freely, heatmap populates across the world

### Color Coding by Activity Type
- 🚴 **Cycling**: Orange/Red gradient
- 🏃 **Running**: Blue/Purple gradient
- 🚶 **Walking/Hiking**: Green gradient
- Other: Gray/neutral

### Route Highlight on Selection
When user clicks a workout in the list:
1. Smooth pan/zoom to workout bounding box
2. Render selected route as bright line on top of heatmap
3. Show start/end markers
4. Dim or maintain heatmap underneath

---

## Current Codebase Analysis

### Tech Stack
- **Frontend**: React 19 + Vite + TypeScript + Tailwind
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL 16
- **Maps**: Mapbox GL JS 3.15.0 (already integrated)

### Existing GPS Data Structure
```sql
-- workout_routes table
route_points JSONB  -- Array of GPS points
total_points INTEGER
min_latitude, max_latitude, min_longitude, max_longitude  -- Bounding box
```

```typescript
interface RoutePoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  timestamp: string;
  speed: number | null;
}
```

### Current Map Implementation (`WorkoutMap.tsx`)
- Single route visualization only
- GeoJSON LineString rendering
- Markers for start/end
- Auto-fit bounds
- Style: `mapbox://styles/mapbox/outdoors-v12`

### Relevant Indexes
- `idx_workouts_start_date` - date range queries
- `idx_workouts_type` - filter by activity type (Cycling)
- `idx_workouts_user_start` - user + date combo

---

## Implementation Options

### Option A: Mapbox Heatmap Layer (Point-Based)
Convert GPS points to point cloud, render with Mapbox's native heatmap layer.

**Pros:**
- Native Mapbox support, 60fps rendering
- Handles 400k+ points
- Clustering support for performance
- Dynamic color ramps, intensity, radius

**Cons:**
- Loses line continuity (points, not paths)
- May look "blobby" vs Strava's crisp lines
- Requires extracting points from all routes

**Data Format Required:**
```javascript
// GeoJSON FeatureCollection of Points
{
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] } },
    // ... thousands of points
  ]
}
```

**Key Properties:**
- `heatmap-weight`: point contribution (can use clustering `point_count`)
- `heatmap-intensity`: zoom-dependent multiplier
- `heatmap-radius`: pixel radius of influence
- `heatmap-color`: density-to-color ramp

### Option B: Line Overlay with Opacity
Render all routes as semi-transparent lines overlaid on each other.

**Pros:**
- Shows actual routes taken
- Simple to implement (extend current WorkoutMap)
- Natural "heat" from overlapping lines

**Cons:**
- Opacity overlap artifacts (known Mapbox issue)
- Performance degrades with many routes
- No true density weighting

### Option C: Pre-computed Vector Tiles (Strava-like)
Process GPS data offline into vector tiles using Tippecanoe, host on Mapbox.

**Pros:**
- Handles millions of points
- Crisp line rendering like Strava
- Server-side processing offloads client

**Cons:**
- Complex pipeline (Tippecanoe, tile hosting)
- Batch processing (not real-time)
- Significant infrastructure overhead

**Strava's Approach:**
- Translate GPS to Web Mercator Tile coords (zoom 16)
- Bresenham's line algorithm for pixel-perfect paths
- Rasterize each activity as line segments

---

## Recommended Approach

**Option A (Mapbox Heatmap Layer)** with multi-layer architecture:
1. Already have Mapbox GL JS 3.15.0
2. Native support, no external tools
3. Good performance with clustering
4. Multiple heatmap layers for activity type color coding
5. Additional line layer for selected route highlight

### Implementation Plan

#### Backend

**1. Heatmap Data Endpoint**
```
GET /api/heatmap/points
```
Returns all GPS points from all workouts with routes, grouped by activity type.

Response:
```typescript
interface HeatmapResponse {
  points: {
    workout_type: string;
    data: GeoJSON.FeatureCollection<GeoJSON.Point>;
  }[];
  workouts: WorkoutSummary[];  // For sidebar list
}
```

Query:
```sql
SELECT
  w.id, w.workout_type, w.start_date, w.duration_seconds,
  w.total_distance_meters, wr.route_points,
  wr.min_latitude, wr.max_latitude, wr.min_longitude, wr.max_longitude
FROM workouts w
JOIN workout_routes wr ON w.id = wr.workout_id
WHERE w.user_id = $1
ORDER BY w.start_date DESC;
```

**2. Single Route Endpoint** (already exists)
```
GET /api/workout/:id/route
```
Used when user clicks workout to show highlighted route.

#### Frontend

**New Page: `/heatmap` or `/map`**

```typescript
// HeatmapPage.tsx structure
export function HeatmapPage() {
  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<WorkoutRoute | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // On mount: get user location, load heatmap data
  // On workout click: fetch route, pan map, show highlight
}
```

**Map Layers (bottom to top):**
1. Base map (dark style)
2. Cycling heatmap layer (orange/red)
3. Running heatmap layer (blue/purple)
4. Walking heatmap layer (green)
5. Selected route line layer (bright white/yellow)
6. Start/end markers for selected route

**Heatmap Layer Config (per activity type):**
```typescript
// Cycling layer example
map.addLayer({
  id: 'heat-cycling',
  type: 'heatmap',
  source: 'points-cycling',
  paint: {
    'heatmap-weight': 1,
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(255,140,0,0)',      // transparent
      0.2, 'rgba(255,140,0,0.4)',  // orange
      0.4, 'rgba(255,100,0,0.6)',
      0.6, 'rgba(255,60,0,0.8)',
      0.8, 'rgba(255,30,0,0.9)',
      1, 'rgba(255,0,0,1)'         // red
    ],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 15, 20],
    'heatmap-opacity': 0.8
  }
});
```

**Selected Route Highlight:**
```typescript
map.addLayer({
  id: 'selected-route',
  type: 'line',
  source: 'selected-route-source',
  paint: {
    'line-color': '#ffffff',
    'line-width': 4,
    'line-opacity': 1
  }
});
```

**Geolocation:**
```typescript
navigator.geolocation.getCurrentPosition(
  (pos) => {
    map.flyTo({
      center: [pos.coords.longitude, pos.coords.latitude],
      zoom: 12
    });
  },
  () => {
    // Fallback: center on most recent workout or Amsterdam
    map.flyTo({ center: [4.9041, 52.3676], zoom: 11 });
  }
);
```

---

## Performance Considerations

### Point Count Estimates
- Typical cycling route: 500-2000 GPS points
- 100 activities: 50k-200k points
- 1 year of cycling: could be 500k+ points

### Optimization Strategies

1. **Clustering** (client-side):
   - Use GeoJSON source with `cluster: true`
   - Use `point_count` as `heatmap-weight`
   ```javascript
   source: {
     type: 'geojson',
     data: points,
     cluster: true,
     clusterRadius: 50
   }
   ```

2. **Server-side decimation**:
   - Sample every Nth point (e.g., every 3rd)
   - Douglas-Peucker simplification
   - Reduce coordinate precision to 5 decimals

3. **GeoJSON optimization**:
   - Remove unused properties
   - Limit precision to 6 decimal places
   - Minify response

4. **Pagination/streaming**:
   - Load by date ranges progressively
   - Show loading indicator

5. **Vector tiles** (future):
   - If >500k points, consider Mapbox Tiling Service
   - Pre-process with Tippecanoe

---

## UI/UX Details

### Page Layout
- **Full viewport height** (no scrolling on page itself)
- **Map**: 70-75% width, full height
- **Sidebar**: 25-30% width, full height, scrollable workout list

### Sidebar (Workout List)
```typescript
interface WorkoutListItem {
  id: string;
  workout_type: string;
  start_date: string;
  duration_seconds: number;
  total_distance_meters: number | null;
  // Computed from route bounding box for pan target
  center: [number, number];
  bounds: [[number, number], [number, number]];
}
```

Display:
- Activity icon (🚴🏃🚶)
- Date/time
- Distance (km)
- Duration
- Click to select → highlight in list + pan map

### Map Controls
- Zoom +/- buttons
- "My Location" button (re-center on geolocation)
- Activity type toggles (show/hide cycling, running, etc.)

### Dark Map Style
Use `mapbox://styles/mapbox/dark-v11` for better heatmap contrast.

### Responsive Considerations
- Mobile: sidebar collapses to bottom sheet or toggle
- Desktop: side-by-side layout

---

## Mapbox Pricing Considerations

Current usage is likely covered by free tier. Heatmap feature adds:
- More map loads (new view)
- Potentially larger GeoJSON data transfers

Free tier includes:
- 50,000 map loads/month
- 50,000 Static Images API requests
- No extra charge for heatmap layers (it's a rendering feature)

---

## References

- [Mapbox Heatmap Tutorial](https://docs.mapbox.com/help/tutorials/make-a-heatmap-with-mapbox-gl-js/)
- [Mapbox Heatmap Layer Example](https://docs.mapbox.com/mapbox-gl-js/example/heatmap-layer/)
- [Working with Large GeoJSON](https://docs.mapbox.com/help/troubleshooting/working-with-large-geojson-data/)
- [Supercluster - Point Clustering](https://github.com/mapbox/supercluster)
- [Strava Global Heatmap Engineering](https://medium.com/strava-engineering/the-global-heatmap-now-6x-hotter-23fc01d301de)
- [Mapbox Clustering with MTS](https://docs.mapbox.com/mapbox-tiling-service/examples/mts-clustering/)

---

## Unresolved Questions

1. **Point sampling rate?** Every point vs every Nth vs Douglas-Peucker?
2. **Pagination for workout list?** Load all or infinite scroll?
3. **Activity type layer blending?** Separate layers (current plan) or combine with different weights?
4. **Mobile layout?** Bottom sheet vs hamburger menu for workout list?
5. **Cache heatmap data?** LocalStorage/IndexedDB for faster reload?
