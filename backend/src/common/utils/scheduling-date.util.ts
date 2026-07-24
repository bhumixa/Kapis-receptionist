/**
 * Date/time helpers shared by `modules/availability` and `modules/
 * appointments` (Milestone 6, docs/adr/ADR-009-scheduling-engine.md).
 *
 * Deliberate simplification, flagged explicitly (docs/SCHEDULING_ARCHITECTURE.md):
 * `WorkingHours`/`BusinessHours` store wall-clock `"HH:mm"` strings with no
 * timezone of their own (docs/SALON_ARCHITECTURE.md, docs/WORKFORCE_
 * ARCHITECTURE.md), and every `DateTime` column in this schema is a plain
 * `TIMESTAMP` (no existing migration uses `@db.Timestamptz` — confirmed
 * during this milestone's own migration). Combining a wall-clock time with a
 * calendar date is therefore done by literal UTC construction
 * (`"{date}T{time}:00.000Z"`), matching the rest of this codebase's existing
 * "no explicit per-tenant-timezone conversion layer" posture rather than
 * introducing the only timezone-aware code path in the system. Full
 * per-tenant-timezone-correct scheduling (`Tenant.timezone`) is an open,
 * explicitly-deferred item for a future pass.
 */

export function combineDateAndTime(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00.000Z`);
}

export function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}
