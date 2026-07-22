import {
  Employee as PrismaEmployee,
  WorkingHours as PrismaWorkingHours,
  EmployeeTimeOff as PrismaEmployeeTimeOff,
} from '@prisma/client';
import { EmployeeEntity } from '../../domain/entities/employee.entity';
import { WorkingHoursEntity } from '../../domain/entities/working-hours.entity';
import { EmployeeTimeOffEntity } from '../../domain/entities/employee-time-off.entity';

export function toEmployeeEntity(row: PrismaEmployee): EmployeeEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    phoneNumber: row.phoneNumber,
    status: row.status,
    colorTag: row.colorTag,
    bio: row.bio,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toWorkingHoursEntity(
  row: PrismaWorkingHours,
): WorkingHoursEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    dayOfWeek: row.dayOfWeek,
    startTime: timeToHhMm(row.startTime),
    endTime: timeToHhMm(row.endTime),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toEmployeeTimeOffEntity(
  row: PrismaEmployeeTimeOff,
): EmployeeTimeOffEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    startDate: dateToIsoDateString(row.startDate),
    endDate: dateToIsoDateString(row.endDate),
    reason: row.reason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Same UTC-accessor convention as `modules/salon`'s `prisma-salon.mappers.ts`
 * (docs/SALON_ARCHITECTURE.md Section 2.3) — Prisma maps `@db.Time`/`@db.Date`
 * to a JS `Date` with an arbitrary/irrelevant date or time-of-day part;
 * reading/writing via UTC accessors keeps storage tz-agnostic, independent
 * of the server process's local timezone.
 */
export function timeToHhMm(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const mm = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function hhMmToTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00Z`);
}

export function dateToIsoDateString(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isoDateStringToDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}
