// API Response Types

export interface WorkoutSummary {
  id: string;
  workout_type: string;
  start_date: string;
  end_date: string;
  duration_seconds: number;
  total_distance_meters: number | null;
  has_route: boolean;
}

export interface ActivityRing {
  date: string;
  move_goal_kcal: number;
  move_actual_kcal: number;
  move_percent: number;
  exercise_goal_minutes: number;
  exercise_actual_minutes: number;
  exercise_percent: number;
  stand_goal_hours: number;
  stand_actual_hours: number;
  stand_percent: number;
}

export interface SummaryStats {
  total_workouts: number;
  total_distance_km: number;
  total_calories: number;
  avg_workout_duration_minutes: number;
}

export interface DashboardResponse {
  workouts: WorkoutSummary[];
  activity_rings: ActivityRing[];
  summary: SummaryStats;
}

export interface WorkoutDetail {
  id: string;
  user_id: string;
  healthkit_uuid: string;
  workout_type: string;
  start_date: string;
  end_date: string;
  duration_seconds: number;
  total_distance_meters: number | null;
  total_energy_burned_kcal: number | null;
  avg_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  timestamp: string;
  horizontal_accuracy: number | null;
  vertical_accuracy: number | null;
  speed: number | null;
}

export interface WorkoutRoute {
  workout_id: string;
  route_data: RoutePoint[];
  bounding_box: {
    min_lat: number;
    max_lat: number;
    min_lon: number;
    max_lon: number;
  };
}

export interface HealthMetric {
  id: string;
  user_id: string;
  metric_type: string;
  start_date: string;
  end_date: string;
  value: number;
  unit: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
