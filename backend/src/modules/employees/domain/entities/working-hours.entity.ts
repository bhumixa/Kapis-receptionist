/**
 * A recurring weekly schedule row for one employee. No day-uniqueness
 * (docs/WORKFORCE_ARCHITECTURE.md) — split shifts (multiple rows on the
 * same `dayOfWeek`) are valid, unlike the salon-wide `BusinessHours`.
 */
export interface WorkingHoursEntity {
  id: string;
  tenantId: string;
  employeeId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
