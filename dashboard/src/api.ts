import type {
	ActivityRing,
	DashboardResponse,
	HealthMetric,
	WorkoutDetail,
	WorkoutRoute,
} from "./types";

// API configuration from environment variables.
// Default is relative (same origin): in production the backend serves this
// build itself. Local split-process dev sets VITE_API_URL via dev-server.sh.
const API_BASE_URL = import.meta.env.VITE_API_URL || "";
const API_KEY = import.meta.env.VITE_API_KEY;

/// The route shape the backend actually returns, before it's reshaped into the
/// WorkoutRoute the map component consumes.
interface RawRoutePoint {
	lat: number;
	lon: number;
	altitude: number | null;
	timestamp: string;
	horizontal_accuracy: number | null;
	vertical_accuracy?: number | null;
	speed: number | null;
}

interface RawWorkoutRoute {
	workout_id: string;
	points?: RawRoutePoint[];
}

class ApiClient {
	private baseURL: string;
	private apiKey: string | undefined;

	constructor(baseURL: string, apiKey: string | undefined) {
		this.baseURL = baseURL;
		this.apiKey = apiKey;
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const url = `${this.baseURL}${endpoint}`;
		// Record rather than HeadersInit: HeadersInit is a union (Headers | string[][] |
		// Record) and so can't be indexed by name below. Callers only ever pass plain
		// objects, so narrowing here is safe.
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(options.headers as Record<string, string> | undefined),
		};

		// Add API key if available
		if (this.apiKey) {
			headers["X-API-Key"] = this.apiKey;
		}

		const response = await fetch(url, {
			...options,
			headers,
		});

		if (!response.ok) {
			throw new Error(`API Error: ${response.status} ${response.statusText}`);
		}

		const json = await response.json();

		// Unwrap backend response structure
		if (json.success) {
			// Handle different response formats: { success: true, data: {...} } or { success: true, workout: {...} }, etc.
			if (json.data) return json.data as T;
			if (json.workout) return json.workout as T;
			if (json.route) return json.route as T;
		}

		return json as T;
	}

	// Dashboard endpoints
	async getDashboard(days = 7): Promise<DashboardResponse> {
		return this.request<DashboardResponse>(
			`/api/dashboard/recent?days=${days}`,
		);
	}

	// Workout endpoints
	async getWorkout(id: string): Promise<WorkoutDetail> {
		return this.request<WorkoutDetail>(`/api/workout/${id}`);
	}

	async getWorkoutRoute(id: string): Promise<WorkoutRoute> {
		const response = await this.request<RawWorkoutRoute>(
			`/api/workout/${id}/route`,
		);

		// Transform backend format to frontend format
		const points = response.points ?? [];
		const route_data = points.map((p) => ({
			latitude: p.lat,
			longitude: p.lon,
			altitude: p.altitude,
			timestamp: p.timestamp,
			horizontal_accuracy: p.horizontal_accuracy,
			vertical_accuracy: p.vertical_accuracy || null,
			speed: p.speed,
		}));

		// Calculate bounding box
		const lats = points.map((p) => p.lat);
		const lons = points.map((p) => p.lon);

		return {
			workout_id: response.workout_id,
			route_data,
			bounding_box: {
				min_lat: Math.min(...lats),
				max_lat: Math.max(...lats),
				min_lon: Math.min(...lons),
				max_lon: Math.max(...lons),
			},
		};
	}

	// Activity rings endpoints
	async getActivityRings(date: string): Promise<ActivityRing> {
		return this.request<ActivityRing>(`/api/activity-rings/${date}`);
	}

	// Health metrics endpoints
	async getHealthMetrics(
		metricType: string,
		startDate?: string,
		endDate?: string,
	): Promise<HealthMetric[]> {
		let url = `/api/health-metrics/${metricType}`;
		const params = new URLSearchParams();

		// snake_case: the backend reads req.query.start_date / end_date and 400s
		// without them.
		if (startDate) params.append("start_date", startDate);
		if (endDate) params.append("end_date", endDate);

		const queryString = params.toString();
		if (queryString) {
			url += `?${queryString}`;
		}

		return this.request<HealthMetric[]>(url);
	}
}

// Export singleton instance
export const api = new ApiClient(API_BASE_URL, API_KEY);
