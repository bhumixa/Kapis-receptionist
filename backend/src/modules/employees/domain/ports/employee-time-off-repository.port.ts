import { EmployeeTimeOffEntity } from '../entities/employee-time-off.entity';

export const EMPLOYEE_TIME_OFF_REPOSITORY = Symbol(
  'EMPLOYEE_TIME_OFF_REPOSITORY',
);

export interface CreateEmployeeTimeOffInput {
  startDate: string;
  endDate: string;
  reason?: string | null;
}

export interface EmployeeTimeOffRepositoryPort {
  findAllForEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeTimeOffEntity[]>;
  findByIdForEmployee(
    tenantId: string,
    employeeId: string,
    id: string,
  ): Promise<EmployeeTimeOffEntity | null>;
  create(
    tenantId: string,
    employeeId: string,
    input: CreateEmployeeTimeOffInput,
  ): Promise<EmployeeTimeOffEntity>;
  /** Hard delete — a low-stakes leaf entity; the audit log preserves the trail. */
  delete(tenantId: string, employeeId: string, id: string): Promise<void>;
}
