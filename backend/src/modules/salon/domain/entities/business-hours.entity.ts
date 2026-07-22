/**
 * Wall-clock storage: `startTime`/`endTime` are `"HH:mm"` strings, not tied
 * to any timezone at this layer — interpretation timezone is `Tenant.timezone`,
 * read separately when a future Availability engine needs it (docs/
 * SALON_ARCHITECTURE.md). When `isClosed` is true the DB still stores a
 * `"00:00"` placeholder (the column is NOT NULL) — clients must ignore
 * `startTime`/`endTime` whenever `isClosed` is true rather than relying on
 * them being null.
 */
export interface BusinessHoursEntity {
  id: string;
  tenantId: string;
  /** 0=Sunday..6=Saturday. */
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isClosed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const BUSINESS_HOURS_DAYS_PER_WEEK = 7;
