/**
 * A date-range unavailability record for one employee (vacation, sick leave)
 * — a new, dedicated model (Milestone 5, docs/adr/ADR-008), kept separate
 * from the tenant-wide `Holiday` table shipped in Milestone 4.
 */
export interface EmployeeTimeOffEntity {
  id: string;
  tenantId: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
