/** Mirrors `backend/src/modules/employees/interface/dto/time-off-response.dto.ts`. */
export interface EmployeeTimeOff {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdAt: string;
}
