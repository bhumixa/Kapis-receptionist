import { WorkingHoursEntity } from '../entities/working-hours.entity';

export const WORKING_HOURS_REPOSITORY = Symbol('WORKING_HOURS_REPOSITORY');

export interface WorkingHoursEntryInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface WorkingHoursRepositoryPort {
  findAllForEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<WorkingHoursEntity[]>;
  /** Full-replace: deletes the employee's existing rows and inserts the given set, in one transaction. */
  replaceAllForEmployee(
    tenantId: string,
    employeeId: string,
    entries: WorkingHoursEntryInput[],
  ): Promise<WorkingHoursEntity[]>;
}
