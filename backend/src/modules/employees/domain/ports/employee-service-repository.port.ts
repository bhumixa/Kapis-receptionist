export const EMPLOYEE_SERVICE_REPOSITORY = Symbol(
  'EMPLOYEE_SERVICE_REPOSITORY',
);

/**
 * The `EmployeeService` junction — the composite-FK cross-tenant pattern's
 * first real consumer (docs/TENANT_ARCHITECTURE.md Section 4.1). Owned by
 * `modules/employees` (docs/adr/ADR-008 decision #3), so `Employee ↔
 * Service` assignment is always mutated from the employee side.
 */
export interface EmployeeServiceRepositoryPort {
  findServiceIdsForEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<string[]>;
  findEmployeeIdsForService(
    tenantId: string,
    serviceId: string,
  ): Promise<string[]>;
  /** Full-replace: deletes the employee's existing assignments and inserts the given set, in one transaction. */
  replaceForEmployee(
    tenantId: string,
    employeeId: string,
    serviceIds: string[],
  ): Promise<string[]>;
}
