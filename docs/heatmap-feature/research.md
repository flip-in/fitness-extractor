# Heatmap Feature Research

## Goal
Display cycling activities in Amsterdam as a heatmap to visualize route frequency/density at a glance.

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

**Start with Option A (Mapbox Heatmap Layer)** because:
1. Already have Mapbox GL JS 3.15.0
2. Native support, no external tools
3. Good performance with clustering
4. Can enhance later (Option C) if needed

### Implementation Plan

#### Backend
1. New endpoint: `GET /api/heatmap/data`
   - Query params: `days`, `workout_type`
   - Returns: GeoJSON FeatureCollection of points from all matching routes
   - Consider: sampling/decimation for large datasets

2. Query pattern:
```sql
SELECT wr.route_points
FROM workout_routes wr
JOIN workouts w ON wr.workout_id = w.id
WHERE w.user_id = $1
  AND w.workout_type = 'Cycling'
  AND w.start_date >= NOW() - INTERVAL '$2 days';
```

#### Frontend
1. New component: `HeatmapView.tsx`
2. Add to dashboard (new tab/section or separate page)
3. Mapbox heatmap layer config:

```typescript
map.addLayer({
  id: 'cycling-heat',
  type: 'heatmap',
  source: 'cycling-points',
  paint: {
    'heatmap-weight': 1,
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(0,0,255,0)',
      0.2, 'rgb(0,255,255)',
      0.4, 'rgb(0,255,0)',
      0.6, 'rgb(255,255,0)',
      0.8, 'rgb(255,128,0)',
      1, 'rgb(255,0,0)'
    ],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 15, 20],
    'heatmap-opacity': 0.8
  }
});
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

## UI/UX Considerations

### Placement Options
1. **New "Heatmap" tab** on dashboard
2. **Toggle on existing map** (if we add a main map view)
3. **Separate page** (`/heatmap`)

### Controls
- Time range selector (7/30/90/365 days, all time)
- Activity type filter (Cycling, Running, etc.)
- Opacity/intensity slider (optional)

### Amsterdam-Specific
- Default bounds to Amsterdam area
- Consider dark map style for better heatmap visibility
- Style: `mapbox://styles/mapbox/dark-v11`

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

1. **Point sampling rate?** - Every point vs every Nth vs Douglas-Peucker?
2. **Time range default?** - All time might be too heavy initially
3. **Include other activity types?** - Start cycling-only or multi-sport?
4. **Show routes on click?** - Interactive heatmap or static visualization?
5. **Dark mode map style?** - Better heatmap visibility vs current outdoors style?
