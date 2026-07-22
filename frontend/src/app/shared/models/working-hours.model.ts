/** Mirrors `backend/src/modules/employees/interface/dto/working-hours-response.dto.ts`. */
export interface WorkingHoursEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

/** Index-aligned with `dayOfWeek` (0=Sunday..6=Saturday) — same convention as `business-hours.model.ts`. */
export const DAY_OF_WEEK_LABELS: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
