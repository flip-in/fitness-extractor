import { useEffect, useState } from "react";
import { api } from "../api";
import { ActivityRings } from "../components/ActivityRings";
import { WorkoutMap } from "../components/WorkoutMap";
import type { DashboardResponse, WorkoutDetail, WorkoutRoute } from "../types";

export function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  // Selected workout state
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutDetail | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<WorkoutRoute | null>(null);
  const [loadingWorkout, setLoadingWorkout] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, [days]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const dashboardData = await api.getDashboard(days);
      setData(dashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  const loadWorkoutDetails = async (workoutId: string) => {
    try {
      setLoadingWorkout(true);
      const workout = await api.getWorkout(workoutId);
      setSelectedWorkout(workout);

      // Try to load route
      try {
        const route = await api.getWorkoutRoute(workoutId);
        setSelectedRoute(route);
      } catch {
        setSelectedRoute(null);
      }
    } catch (err) {
      console.error("Failed to load workout details:", err);
    } finally {
      setLoadingWorkout(false);
    }
  };

  const closeWorkoutDetails = () => {
    setSelectedWorkout(null);
    setSelectedRoute(null);
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatDetailedDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatDistance = (meters: number | null) => {
    if (!meters) return "N/A";
    const km = meters / 1000;
    return `${km.toFixed(2)} km`;
  };

  const formatWorkoutType = (type: string) => {
    return type.replace(/([A-Z])/g, " $1").trim();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">Error</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-6">{error}</p>
          <button
            type="button"
            onClick={loadDashboard}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-gray-600 dark:text-gray-400">No data available</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Fitness Dashboard
          </h1>
          <div className="flex gap-2">
            <button
              type="button"
              className={`px-4 py-2 rounded-lg font-medium transition ${
                days === 7
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              onClick={() => setDays(7)}
            >
              7 Days
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-lg font-medium transition ${
                days === 30
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              onClick={() => setDays(30)}
            >
              30 Days
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-lg font-medium transition ${
                days === 90
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              onClick={() => setDays(90)}
            >
              90 Days
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Summary Stats */}
          <section className="lg:col-span-2">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Summary ({days} Days)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                  {data.summary.total_workouts}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Workouts</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                  {data.summary.total_distance_km.toFixed(1)} km
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Distance</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                  {(data.summary.avg_workout_duration_minutes / 60).toFixed(1)}h
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Duration</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                  {null ? `${Math.round(null)} bpm` : "N/A"}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Avg HR</div>
              </div>
            </div>

            {/* Recent Workouts */}
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Recent Workouts
            </h2>
            {data.workouts.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">No workouts found</p>
            ) : (
              <div className="space-y-3">
                {data.workouts.map((workout) => (
                  <button
                    key={workout.id}
                    type="button"
                    onClick={() => loadWorkoutDetails(workout.id)}
                    className="w-full text-left bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-lg transition p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {formatWorkoutType(workout.workout_type)}
                      </h3>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(workout.start_date)}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                      <span>{formatDuration(workout.duration_seconds)}</span>
                      <span>{formatDistance(workout.total_distance_meters)}</span>
                      {workout.has_route && (
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                          📍 GPS
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Activity Rings */}
          {data.activity_rings.length > 0 && (
            <section className="lg:col-span-1">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Today's Activity
              </h2>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <ActivityRings rings={data.activity_rings[0]} />
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Workout Detail Modal */}
      {selectedWorkout && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  {formatWorkoutType(selectedWorkout.workout_type)}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {formatDateTime(selectedWorkout.start_date)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeWorkoutDetails}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Map */}
              {selectedRoute && (
                <div>
                  <WorkoutMap route={selectedRoute} />
                </div>
              )}

              {/* Stats */}
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Stats</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Duration</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      {formatDetailedDuration(selectedWorkout.duration_seconds)}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Distance</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      {formatDistance(selectedWorkout.total_distance_meters)}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Calories</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      {selectedWorkout.total_energy_burned_kcal
                        ? `${Math.round(selectedWorkout.total_energy_burned_kcal)}`
                        : "N/A"}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Avg HR</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      {selectedWorkout.avg_heart_rate_bpm
                        ? `${Math.round(selectedWorkout.avg_heart_rate_bpm)} bpm`
                        : "N/A"}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Max HR</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      {selectedWorkout.max_heart_rate_bpm
                        ? `${Math.round(selectedWorkout.max_heart_rate_bpm)} bpm`
                        : "N/A"}
                    </div>
                  </div>
                  {selectedRoute && (
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">GPS Points</div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white">
                        {selectedRoute.route_data.length}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Metadata */}
              {selectedWorkout.metadata && Object.keys(selectedWorkout.metadata).length > 0 && (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Additional Info</h3>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <pre className="text-sm text-gray-700 dark:text-gray-300 overflow-x-auto">
                      {JSON.stringify(selectedWorkout.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay for workout details */}
      {loadingWorkout && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
            <div className="text-xl text-gray-900 dark:text-white">Loading workout...</div>
          </div>
        </div>
      )}
    </div>
  );
}
