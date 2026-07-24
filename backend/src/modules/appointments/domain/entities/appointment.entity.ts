import { AppointmentStatus } from '@prisma/client';

/**
 * One service line within an appointment (Milestone 6, docs/adr/ADR-009-
 * scheduling-engine.md). Per-service employee assignment: each line has its
 * own `[startTime, endTime)` sub-window (sequential, no gap, within one
 * continuous visit) and its own `employeeId` — a single visit may have
 * different services performed by different employees in sequence.
 * `blockedUntil`/`isBlocking` back the database-level conflict-prevention
 * constraint (see `AppointmentsModule`'s doc comment).
 */
export interface AppointmentServiceLineEntity {
  id: string;
  serviceId: string;
  employeeId: string;
  serviceNameSnapshot: string;
  durationMinutesSnapshot: number;
  priceCentsSnapshot: number;
  bufferMinutesSnapshot: number;
  sequenceOrder: number;
  startTime: Date;
  endTime: Date;
  blockedUntil: Date;
  isBlocking: boolean;
}

/**
 * The booking itself. `employeeId` is a *denormalized "primary"* value (the
 * first `sequenceOrder` line's employee) — convenient for simple
 * `filter[employeeId]` queries and calendar display, never authoritative
 * for conflict/availability (the `services` lines are).
 */
export interface AppointmentEntity {
  id: string;
  tenantId: string;
  customerId: string;
  employeeId: string;
  status: AppointmentStatus;
  startTime: Date;
  endTime: Date;
  totalPriceCents: number;
  currency: string;
  notes: string | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  rescheduledFromAppointmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  services: AppointmentServiceLineEntity[];
}
