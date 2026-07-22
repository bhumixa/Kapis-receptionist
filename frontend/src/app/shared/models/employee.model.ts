/** Mirrors `backend/src/modules/employees/interface/dto/employee-response.dto.ts`. */
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';

export interface Employee {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  status: EmployeeStatus;
  colorTag: string | null;
  bio: string | null;
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  INACTIVE: 'Inactive',
};
