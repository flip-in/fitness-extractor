import type {
  DashboardResponse,
  WorkoutDetail,
  WorkoutRoute,
  ActivityRing,
  HealthMetric,
} from "./types";

// API configuration from environment variables
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const API_KEY = import.meta.env.VITE_API_KEY;

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
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
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
    const response: any = await this.request(`/api/workout/${id}/route`);

    // Transform backend format to frontend format
    const points = response.points || [];
    const route_data = points.map((p: any) => ({
      latitude: p.lat,
      longitude: p.lon,
      altitude: p.altitude,
      timestamp: p.timestamp,
      horizontal_accuracy: p.horizontal_accuracy,
      vertical_accuracy: p.vertical_accuracy || null,
      speed: p.speed,
    }));

    // Calculate bounding box
    const lats = points.map((p: any) => p.lat);
    const lons = points.map((p: any) => p.lon);

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

    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    return this.request<HealthMetric[]>(url);
  }
}

// Export singleton instance
export const api = new ApiClient(API_BASE_URL, API_KEY);
