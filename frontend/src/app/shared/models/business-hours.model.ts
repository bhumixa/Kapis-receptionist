/** Mirrors `backend/src/modules/salon/interface/dto/business-hours-response.dto.ts`. */
export interface BusinessHoursDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isClosed: boolean;
}

/** Index-aligned with `dayOfWeek` (0=Sunday..6=Saturday). */
export const DAY_OF_WEEK_LABELS: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
