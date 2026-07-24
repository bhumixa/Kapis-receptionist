import { ActorType, AppointmentStatus } from '@prisma/client';
import type { CursorPayload } from '../../../../common/utils/cursor-pagination.util';
import { AppointmentEntity } from '../entities/appointment.entity';

export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');

export interface AppointmentServiceLineInput {
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
}

export interface CreateAppointmentInput {
  customerId: string;
  employeeId: string;
  startTime: Date;
  endTime: Date;
  totalPriceCents: number;
  currency: string;
  notes?: string | null;
  lines: AppointmentServiceLineInput[];
  // `actorType`/`actorId: null` added Milestone 8 (docs/adr/
  // ADR-011-ai-receptionist.md) — every appointment created before this
  // milestone was staff-initiated (`ActorType.USER`, `actorId` always a
  // real `User.id`); an AI/customer-initiated booking has no `User` row to
  // attribute to.
  actorType: ActorType;
  actorId: string | null;
  rescheduledFromAppointmentId?: string;
}

export type AppointmentSortField = 'startTime';

export interface AppointmentListFilter {
  statusIn?: AppointmentStatus[];
  employeeId?: string;
  customerId?: string;
  startTimeGte?: Date;
  startTimeLte?: Date;
  sortDirection: 'asc' | 'desc';
  cursor: CursorPayload | null;
  limit: number;
}

export interface AppointmentRepositoryPort {
  findList(
    tenantId: string,
    filter: AppointmentListFilter,
  ): Promise<AppointmentEntity[]>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<AppointmentEntity | null>;
  /** Atomically creates the `Appointment` + its `AppointmentService` lines + a `CREATED`/`RESCHEDULED` `AppointmentStatusHistory` row. */
  create(
    tenantId: string,
    input: CreateAppointmentInput,
    historyAction: 'CREATED' | 'RESCHEDULED',
  ): Promise<AppointmentEntity>;
  updateNotes(
    tenantId: string,
    id: string,
    notes: string,
  ): Promise<AppointmentEntity>;
  /** Marks the appointment CANCELLED, flips every line's `isBlocking` to `false`, writes a `CANCELLED` history row — one transaction. */
  cancel(
    tenantId: string,
    id: string,
    input: {
      reason: string | null;
      actorType: ActorType;
      actorId: string | null;
    },
  ): Promise<AppointmentEntity>;
  /**
   * Marks the original appointment RESCHEDULED, flips its lines'
   * `isBlocking` to `false`, creates the new appointment (see `create`),
   * and writes a `RESCHEDULED` history row on the original referencing the
   * new id — one transaction.
   */
  reschedule(
    tenantId: string,
    originalId: string,
    newAppointment: CreateAppointmentInput,
  ): Promise<{
    original: AppointmentEntity;
    newAppointment: AppointmentEntity;
  }>;
  /** Soft delete + flips every line's `isBlocking` to `false` — one transaction. */
  softDelete(tenantId: string, id: string): Promise<void>;
}
