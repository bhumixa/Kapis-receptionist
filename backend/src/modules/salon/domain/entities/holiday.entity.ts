/**
 * Tenant-wide only this milestone — no `employeeId`/`branchId` (Employees/
 * Branch don't exist yet). `date` is a `"YYYY-MM-DD"` string, date-only, no
 * time/timezone component (docs/SALON_ARCHITECTURE.md).
 */
export interface HolidayEntity {
  id: string;
  tenantId: string;
  date: string;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}
