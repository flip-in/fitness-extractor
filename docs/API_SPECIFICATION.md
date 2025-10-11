# API Specification - Fitness Extractor

## Overview

RESTful API for syncing HealthKit data from iOS app and serving data to the web dashboard.

**Base URL:** `http://your-nas-ip:3000/api`
**Authentication:** API Key in `X-API-Key` header
**Content-Type:** `application/json`

---

## Authentication

All requests require an API key passed in the header:

```http
X-API-Key: your-secret-api-key
```

### Error Response (401 Unauthorized)

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

---

## Data Sync Endpoints (iOS → Backend)

### POST /api/sync/workouts

Sync workout data from HealthKit.

**Request Body:**

```json
{
  "user_id": "uuid",
  "workouts": [
    {
      "healthkit_uuid": "HK-WORKOUT-UUID-12345",
      "workout_type": "Running",
      "start_date": "2025-01-15T08:00:00Z",
      "end_date": "2025-01-15T08:35:00Z",
      "duration_seconds": 2100,
      "total_distance_meters": 5000.0,
      "total_energy_burned_kcal": 350.0,
      "avg_heart_rate_bpm": 145,
      "max_heart_rate_bpm": 165,
      "source_name": "Apple Watch",
      "source_bundle_id": "com.apple.health",
      "device_name": "Apple Watch Series 9",
      "metadata": {},
      "route": {
        "points": [
          {
            "lat": 37.7749,
            "lon": -122.4194,
            "timestamp": "2025-01-15T08:00:00Z",
            "altitude": 10.5,
            "speed": 2.5,
            "horizontal_accuracy": 5.0
          }
        ]
      }
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "synced": 1,
  "skipped": 0,
  "errors": []
}
```

**Response (207 Multi-Status - Partial Success):**

```json
{
  "success": true,
  "synced": 2,
  "skipped": 1,
  "errors": [
    {
      "healthkit_uuid": "HK-WORKOUT-UUID-DUPLICATE",
      "error": "Duplicate workout"
    }
  ]
}
```

**Notes:**
- Duplicate `healthkit_uuid` values are skipped (not an error)
- Route data is optional
- Validates workout types against known HealthKit types

---

### POST /api/sync/health-metrics

Sync health metric samples from HealthKit.

**Request Body:**

```json
{
  "user_id": "uuid",
  "metrics": [
    {
      "healthkit_uuid": "HK-METRIC-UUID-12345",
      "metric_type": "heartRate",
      "value": 72.0,
      "unit": "bpm",
      "start_date": "2025-01-15T10:00:00Z",
      "end_date": "2025-01-15T10:00:00Z",
      "source_name": "Apple Watch",
      "source_bundle_id": "com.apple.health",
      "device_name": "Apple Watch Series 9",
      "metadata": {}
    },
    {
      "healthkit_uuid": "HK-METRIC-UUID-12346",
      "metric_type": "stepCount",
      "value": 1250.0,
      "unit": "steps",
      "start_date": "2025-01-15T10:00:00Z",
      "end_date": "2025-01-15T11:00:00Z",
      "source_name": "iPhone",
      "source_bundle_id": "com.apple.health",
      "device_name": "iPhone 15 Pro",
      "metadata": {}
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "synced": 2,
  "skipped": 0,
  "errors": []
}
```

**Notes:**
- Supports all HealthKit metric types
- Duplicate `healthkit_uuid` values are skipped

---

### POST /api/sync/activity-rings

Sync daily activity ring data from HealthKit.

**Request Body:**

```json
{
  "user_id": "uuid",
  "activity_rings": [
    {
      "date": "2025-01-15",
      "move_goal_kcal": 600,
      "move_actual_kcal": 725,
      "move_percent": 120.83,
      "exercise_goal_minutes": 30,
      "exercise_actual_minutes": 42,
      "exercise_percent": 140.0,
      "stand_goal_hours": 12,
      "stand_actual_hours": 11,
      "stand_percent": 91.67
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "synced": 1,
  "updated": 0
}
```

**Notes:**
- Upserts based on `(user_id, date)` unique constraint
- If record exists for date, it's updated (activity rings can change throughout the day)

---

### POST /api/sync/anchors

Update sync anchor after successful sync.

**Request Body:**

```json
{
  "user_id": "uuid",
  "data_type": "workouts",
  "anchor_data": "base64-encoded-anchor-string"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Anchor updated"
}
```

**Notes:**
- Called after each successful data sync
- iOS app sends serialized HKQueryAnchor as base64 string

---

### GET /api/sync/anchors/:userId/:dataType

Get the latest sync anchor for a data type.

**Path Parameters:**
- `userId` - User UUID
- `dataType` - Data type (e.g., "workouts", "heartRate", "activitySummary")

**Response (200 OK):**

```json
{
  "success": true,
  "anchor_data": "base64-encoded-anchor-string",
  "last_sync_at": "2025-01-15T12:30:00Z"
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "message": "No anchor found for data type"
}
```

**Notes:**
- Used by iOS app to get last anchor before syncing
- If no anchor exists, returns 404 (iOS should treat as first sync)

---

### POST /api/sync/import-historical

Trigger historical data import (90 days).

**Request Body:**

```json
{
  "user_id": "uuid",
  "import_type": "full",
  "days_back": 90
}
```

**Response (202 Accepted):**

```json
{
  "success": true,
  "message": "Historical import initiated",
  "import_id": "uuid"
}
```

**Notes:**
- This endpoint just acknowledges the request
- iOS app handles the actual data fetching and sends via standard sync endpoints
- Could be used for progress tracking in future

---

## Dashboard Endpoints (Web → Backend)

### GET /api/dashboard/recent

Get recent activity data for dashboard (last 7 days by default).

**Query Parameters:**
- `days` (optional) - Number of days to fetch (default: 7, max: 90)
- `user_id` (optional) - User ID (defaults to single user in MVP)

**Example Request:**
```http
GET /api/dashboard/recent?days=7
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "workouts": [
      {
        "id": "uuid",
        "workout_type": "Running",
        "start_date": "2025-01-15T08:00:00Z",
        "end_date": "2025-01-15T08:35:00Z",
        "duration_seconds": 2100,
        "total_distance_meters": 5000.0,
        "total_energy_burned_kcal": 350.0,
        "avg_heart_rate_bpm": 145,
        "max_heart_rate_bpm": 165,
        "has_route": true
      }
    ],
    "activity_rings": [
      {
        "date": "2025-01-15",
        "move_goal_kcal": 600,
        "move_actual_kcal": 725,
        "move_percent": 120.83,
        "exercise_goal_minutes": 30,
        "exercise_actual_minutes": 42,
        "exercise_percent": 140.0,
        "stand_goal_hours": 12,
        "stand_actual_hours": 11,
        "stand_percent": 91.67
      }
    ],
    "summary": {
      "total_workouts": 5,
      "total_distance_km": 32.5,
      "total_calories": 2100,
      "avg_workout_duration_minutes": 42
    }
  }
}
```

**Notes:**
- Returns consolidated view for dashboard
- Includes summary statistics
- `has_route` indicates if workout has GPS data

---

### GET /api/workout/:id

Get detailed workout information.

**Path Parameters:**
- `id` - Workout UUID

**Response (200 OK):**

```json
{
  "success": true,
  "workout": {
    "id": "uuid",
    "workout_type": "Running",
    "start_date": "2025-01-15T08:00:00Z",
    "end_date": "2025-01-15T08:35:00Z",
    "duration_seconds": 2100,
    "total_distance_meters": 5000.0,
    "total_energy_burned_kcal": 350.0,
    "avg_heart_rate_bpm": 145,
    "max_heart_rate_bpm": 165,
    "source_name": "Apple Watch",
    "device_name": "Apple Watch Series 9",
    "metadata": {}
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "message": "Workout not found"
}
```

---

### GET /api/workout/:id/route

Get GPS route data for a workout.

**Path Parameters:**
- `id` - Workout UUID

**Response (200 OK):**

```json
{
  "success": true,
  "route": {
    "workout_id": "uuid",
    "total_points": 350,
    "points": [
      {
        "lat": 37.7749,
        "lon": -122.4194,
        "timestamp": "2025-01-15T08:00:00Z",
        "altitude": 10.5,
        "speed": 2.5,
        "horizontal_accuracy": 5.0
      }
    ],
    "bounds": {
      "min_lat": 37.7700,
      "max_lat": 37.7800,
      "min_lon": -122.4250,
      "max_lon": -122.4150
    }
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "message": "No route data for this workout"
}
```

**Notes:**
- Returns all GPS points for rendering on map
- Includes bounding box for map initialization
- Points are ordered by timestamp

---

### GET /api/activity-rings/:date

Get activity rings for a specific date.

**Path Parameters:**
- `date` - Date in YYYY-MM-DD format

**Example Request:**
```http
GET /api/activity-rings/2025-01-15
```

**Response (200 OK):**

```json
{
  "success": true,
  "activity_rings": {
    "date": "2025-01-15",
    "move_goal_kcal": 600,
    "move_actual_kcal": 725,
    "move_percent": 120.83,
    "exercise_goal_minutes": 30,
    "exercise_actual_minutes": 42,
    "exercise_percent": 140.0,
    "stand_goal_hours": 12,
    "stand_actual_hours": 11,
    "stand_percent": 91.67
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "message": "No activity ring data for this date"
}
```

---

### GET /api/health-metrics/:metricType

Get health metrics of a specific type.

**Path Parameters:**
- `metricType` - Metric type (e.g., "heartRate", "stepCount")

**Query Parameters:**
- `start_date` (required) - ISO 8601 timestamp
- `end_date` (required) - ISO 8601 timestamp
- `user_id` (optional) - User ID (defaults to single user)

**Example Request:**
```http
GET /api/health-metrics/heartRate?start_date=2025-01-15T00:00:00Z&end_date=2025-01-15T23:59:59Z
```

**Response (200 OK):**

```json
{
  "success": true,
  "metric_type": "heartRate",
  "unit": "bpm",
  "data": [
    {
      "value": 72.0,
      "start_date": "2025-01-15T10:00:00Z",
      "end_date": "2025-01-15T10:00:00Z",
      "source_name": "Apple Watch"
    },
    {
      "value": 145.0,
      "start_date": "2025-01-15T11:30:00Z",
      "end_date": "2025-01-15T11:30:00Z",
      "source_name": "Apple Watch"
    }
  ]
}
```

**Notes:**
- Used for charting specific metrics over time
- Returns data ordered by `start_date` ascending

---

## Health Check Endpoint

### GET /api/health

Simple health check endpoint.

**Response (200 OK):**

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T12:00:00Z",
  "version": "1.0.0"
}
```

**Notes:**
- No authentication required
- Used for monitoring and deployment verification

---

## Error Responses

### 400 Bad Request

```json
{
  "error": "Bad Request",
  "message": "Invalid request body",
  "details": [
    {
      "field": "workouts[0].start_date",
      "error": "Invalid ISO 8601 date format"
    }
  ]
}
```

### 401 Unauthorized

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

### 404 Not Found

```json
{
  "error": "Not Found",
  "message": "Resource not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "request_id": "uuid"
}
```

---

## Rate Limiting (Future)

For MVP, no rate limiting is implemented (single user, Tailscale-only access).

Future considerations:
- 100 requests per minute per API key
- 1000 requests per hour per API key
- Return `429 Too Many Requests` when exceeded

---

## Request/Response Examples

### Complete Workout Sync Flow

**1. iOS app gets last anchor:**

```http
GET /api/sync/anchors/user-uuid/workouts
X-API-Key: your-api-key
```

Response (404 if first sync):
```json
{
  "success": false,
  "message": "No anchor found for data type"
}
```

**2. iOS app queries HealthKit with anchor (or from beginning if no anchor)**

**3. iOS app sends workout data:**

```http
POST /api/sync/workouts
X-API-Key: your-api-key
Content-Type: application/json

{
  "user_id": "user-uuid",
  "workouts": [
    {
      "healthkit_uuid": "HK-WORKOUT-UUID-12345",
      "workout_type": "Running",
      "start_date": "2025-01-15T08:00:00Z",
      "end_date": "2025-01-15T08:35:00Z",
      "duration_seconds": 2100,
      "total_distance_meters": 5000.0,
      "total_energy_burned_kcal": 350.0,
      "avg_heart_rate_bpm": 145,
      "max_heart_rate_bpm": 165,
      "source_name": "Apple Watch",
      "source_bundle_id": "com.apple.health",
      "device_name": "Apple Watch Series 9",
      "metadata": {},
      "route": {
        "points": [...]
      }
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "synced": 1,
  "skipped": 0,
  "errors": []
}
```

**4. iOS app updates anchor:**

```http
POST /api/sync/anchors
X-API-Key: your-api-key
Content-Type: application/json

{
  "user_id": "user-uuid",
  "data_type": "workouts",
  "anchor_data": "base64-encoded-new-anchor"
}
```

Response:
```json
{
  "success": true,
  "message": "Anchor updated"
}
```

---

### Dashboard Load Flow

**1. Dashboard requests recent data:**

```http
GET /api/dashboard/recent?days=7
X-API-Key: your-api-key
```

Response:
```json
{
  "success": true,
  "data": {
    "workouts": [...],
    "activity_rings": [...],
    "summary": {...}
  }
}
```

**2. User clicks on a workout with a route:**

```http
GET /api/workout/workout-uuid/route
X-API-Key: your-api-key
```

Response:
```json
{
  "success": true,
  "route": {
    "workout_id": "workout-uuid",
    "total_points": 350,
    "points": [...],
    "bounds": {...}
  }
}
```

---

## Data Validation Rules

### Workouts
- `healthkit_uuid`: Required, unique, max 255 chars
- `workout_type`: Required, max 100 chars
- `start_date`: Required, valid ISO 8601
- `end_date`: Required, valid ISO 8601, must be >= start_date
- `duration_seconds`: Required, integer >= 0
- `total_distance_meters`: Optional, decimal >= 0
- `total_energy_burned_kcal`: Optional, decimal >= 0
- `avg_heart_rate_bpm`: Optional, integer 20-250
- `max_heart_rate_bpm`: Optional, integer 20-250

### Health Metrics
- `healthkit_uuid`: Required, unique, max 255 chars
- `metric_type`: Required, max 100 chars
- `value`: Required, decimal
- `unit`: Required, max 50 chars
- `start_date`: Required, valid ISO 8601
- `end_date`: Required, valid ISO 8601

### Activity Rings
- `date`: Required, valid YYYY-MM-DD format
- All `*_goal_*` fields: Required, integer >= 0
- All `*_actual_*` fields: Required, integer >= 0
- All `*_percent` fields: Required, decimal >= 0

---

## API Versioning (Future)

MVP uses unversioned endpoints. Future versions:
- `/api/v1/...`
- `/api/v2/...`

---

## Logging & Monitoring

### Request Logging
Log all incoming requests:
- Timestamp
- Method + Path
- Response status code
- Response time (ms)
- User ID (if available)
- Request ID (generated UUID)

### Error Logging
Log all errors with:
- Stack trace
- Request details
- User ID
- Request ID

### Example Log Entry
```
[2025-01-15T12:00:00Z] POST /api/sync/workouts 200 125ms user_id=uuid request_id=uuid
```

---

## Security Considerations

### API Key Storage
- **Backend:** Store in `.env` file, never commit to git
- **iOS:** Store in Keychain (secure storage)
- **Dashboard:** Store in localStorage (acceptable for single-user Tailscale setup)

### HTTPS Only
- All requests over HTTPS (Tailscale enforces this)
- Reject HTTP requests in production

### Input Validation
- Validate all inputs server-side
- Sanitize strings to prevent injection
- Validate date formats
- Check numeric ranges

### CORS Configuration
- Allow only dashboard origin
- No wildcard `*` in production

### SQL Injection Prevention
- Use parameterized queries
- Never concatenate user input into SQL

---

## Testing the API

### Using curl

**Health check:**
```bash
curl http://localhost:3000/api/health
```

**Sync workouts:**
```bash
curl -X POST http://localhost:3000/api/sync/workouts \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-uuid",
    "workouts": [...]
  }'
```

**Get recent data:**
```bash
curl http://localhost:3000/api/dashboard/recent?days=7 \
  -H "X-API-Key: your-api-key"
```

### Using Postman

1. Create a new collection "Fitness Extractor API"
2. Set collection-level header: `X-API-Key: your-api-key`
3. Add environment with `BASE_URL: http://localhost:3000/api`
4. Import request examples from this document

---

## API Client Libraries

### iOS (Swift)

```swift
class FitnessAPI {
    let baseURL = "http://your-nas-ip:3000/api"
    let apiKey: String

    func syncWorkouts(_ workouts: [Workout]) async throws {
        let url = URL(string: "\(baseURL)/sync/workouts")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        request.httpBody = try JSONEncoder().encode(workouts)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.requestFailed
        }
        // Handle response...
    }
}
```

### Web Dashboard (JavaScript)

```javascript
class FitnessAPI {
  constructor(baseURL, apiKey) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
  }

  async getRecentData(days = 7) {
    const response = await fetch(
      `${this.baseURL}/dashboard/recent?days=${days}`,
      {
        headers: {
          'X-API-Key': this.apiKey
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch recent data');
    }

    return response.json();
  }

  async getWorkoutRoute(workoutId) {
    const response = await fetch(
      `${this.baseURL}/workout/${workoutId}/route`,
      {
        headers: {
          'X-API-Key': this.apiKey
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch route');
    }

    return response.json();
  }
}
```

---

## Next Steps

1. Review this API specification
2. Confirm endpoint design meets requirements
3. Begin backend implementation (Phase 1)

---

## Questions for Review

1. Does this API structure make sense for the use case?
2. Any additional endpoints needed for MVP?
3. Are the request/response formats clear?
4. Any concerns about authentication approach?
5. Ready to start backend implementation?
