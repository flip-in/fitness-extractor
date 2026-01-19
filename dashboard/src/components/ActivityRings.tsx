import type { ActivityRing } from "../types";

interface ActivityRingsProps {
  rings: ActivityRing;
  size?: number;
}

export function ActivityRings({ rings, size = 200 }: ActivityRingsProps) {
  const strokeWidth = 16;
  const radius = (size / 2) - (strokeWidth * 2);
  const circumference = 2 * Math.PI * radius;

  const getRingDashOffset = (percent: number) => {
    return circumference - (circumference * Math.min(percent, 100)) / 100;
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Move ring (outer, red) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#ff3b30"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={getRingDashOffset(rings.move_percent)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity={0.3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#ff3b30"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={getRingDashOffset(rings.move_percent)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />

        {/* Exercise ring (middle, green) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - strokeWidth - 8}
          fill="none"
          stroke="#00ff00"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference - 40}
          strokeDashoffset={getRingDashOffset(rings.exercise_percent)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity={0.3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - strokeWidth - 8}
          fill="none"
          stroke="#00ff00"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference - 40}
          strokeDashoffset={getRingDashOffset(rings.exercise_percent)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />

        {/* Stand ring (inner, blue) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - (strokeWidth * 2) - 16}
          fill="none"
          stroke="#00d4ff"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference - 80}
          strokeDashoffset={getRingDashOffset(rings.stand_percent)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity={0.3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - (strokeWidth * 2) - 16}
          fill="none"
          stroke="#00d4ff"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference - 80}
          strokeDashoffset={getRingDashOffset(rings.stand_percent)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#ff3b30" }} />
          <span className="text-gray-700 dark:text-gray-300">
            Move: {rings.move_actual_kcal}/{rings.move_goal_kcal} kcal
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#00ff00" }} />
          <span className="text-gray-700 dark:text-gray-300">
            Exercise: {rings.exercise_actual_minutes}/{rings.exercise_goal_minutes} min
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#00d4ff" }} />
          <span className="text-gray-700 dark:text-gray-300">
            Stand: {rings.stand_actual_hours}/{rings.stand_goal_hours} hr
          </span>
        </div>
      </div>
    </div>
  );
}
