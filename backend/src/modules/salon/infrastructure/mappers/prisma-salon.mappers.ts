import {
  SalonProfile as PrismaSalonProfile,
  BusinessHours as PrismaBusinessHours,
  Holiday as PrismaHoliday,
} from '@prisma/client';
import { SalonProfileEntity } from '../../domain/entities/salon-profile.entity';
import { BusinessHoursEntity } from '../../domain/entities/business-hours.entity';
import { HolidayEntity } from '../../domain/entities/holiday.entity';

export function toSalonProfileEntity(
  row: PrismaSalonProfile,
): SalonProfileEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    description: row.description,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    website: row.website,
    currency: row.currency,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toBusinessHoursEntity(
  row: PrismaBusinessHours,
): BusinessHoursEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    dayOfWeek: row.dayOfWeek,
    startTime: timeToHhMm(row.startTime),
    endTime: timeToHhMm(row.endTime),
    isClosed: row.isClosed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toHolidayEntity(row: PrismaHoliday): HolidayEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    date: dateToIsoDateString(row.date),
    reason: row.reason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prisma maps Postgres `time` (`@db.Time`) to a JS `Date` with an arbitrary
 * `1970-01-01` date part — this is the first use of that column type in
 * this schema (docs/SALON_ARCHITECTURE.md). Read the wall-clock hour/minute
 * via the UTC accessors, since `hhMmToTime` below always writes with a `Z`
 * suffix — using local accessors here would reintroduce a server-timezone
 * dependency into what's meant to be tz-agnostic storage.
 */
export function timeToHhMm(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const mm = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function hhMmToTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00Z`);
}

/** `@db.Date` also arrives as a JS `Date` — format/parse via UTC accessors for the same tz-agnostic reason. */
export function dateToIsoDateString(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isoDateStringToDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}
