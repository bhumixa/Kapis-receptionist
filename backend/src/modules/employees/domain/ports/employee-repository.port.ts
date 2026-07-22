import { EmployeeStatus } from '@prisma/client';
import { EmployeeEntity } from '../entities/employee.entity';

export const EMPLOYEE_REPOSITORY = Symbol('EMPLOYEE_REPOSITORY');

export interface CreateEmployeeInput {
  userId?: string | null;
  firstName: string;
  lastName: string;
  phoneNumber?: string | null;
  status?: EmployeeStatus;
  colorTag?: string | null;
  bio?: string | null;
}

export interface UpdateEmployeeInput {
  userId?: string | null;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string | null;
  status?: EmployeeStatus;
  colorTag?: string | null;
  bio?: string | null;
}

export type EmployeeSortField = 'firstName' | 'status';

export interface EmployeeListFilter {
  status?: EmployeeStatus;
  /** Restricts to employees eligible for this service (resolved via `EmployeeService` by the caller). */
  employeeIdsIn?: string[];
  q?: string;
  sortField: EmployeeSortField;
  sortDirection: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface EmployeeListResult {
  employees: EmployeeEntity[];
  total: number;
}

export interface EmployeeRepositoryPort {
  findList(
    tenantId: string,
    filter: EmployeeListFilter,
  ): Promise<EmployeeListResult>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<EmployeeEntity | null>;
  findByUserIdForTenant(
    tenantId: string,
    userId: string,
  ): Promise<EmployeeEntity | null>;
  create(tenantId: string, input: CreateEmployeeInput): Promise<EmployeeEntity>;
  update(
    tenantId: string,
    id: string,
    input: UpdateEmployeeInput,
  ): Promise<EmployeeEntity>;
  /** Soft delete (`deletedAt`) — historical references (future `Appointment`) must survive. */
  softDelete(tenantId: string, id: string): Promise<void>;
}
