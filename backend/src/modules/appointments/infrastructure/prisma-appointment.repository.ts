import { Injectable } from '@nestjs/common';
import {
  ActorType,
  AppointmentHistoryAction,
  AppointmentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { cursorWhereClause } from '../../../common/utils/cursor-pagination.util';
import { AppointmentEntity } from '../domain/entities/appointment.entity';
import {
  AppointmentListFilter,
  AppointmentRepositoryPort,
  AppointmentServiceLineInput,
  CreateAppointmentInput,
} from '../domain/ports/appointment-repository.port';
import { toAppointmentEntity } from './mappers/prisma-appointment.mappers';

const APPOINTMENT_INCLUDE = {
  services: true,
} satisfies Prisma.AppointmentInclude;

/**
 * Not a `TenantScopedRepository<T>` subclass — every write here is a
 * multi-statement `$transaction` (appointment + service lines + history
 * row, sometimes across two appointment rows for reschedule), which that
 * base class's single-model primitives don't express. Tenant safety is
 * still enforced structurally: every write targets the compound unique
 * `(tenantId, id)` (`uq_appointments_tenant_id`) as its `WhereUniqueInput`,
 * the same TOCTOU-safe re-assertion `TenantScopedRepository.updateForTenant`
 * gives every other module, just via Prisma's compound-unique selector
 * instead of `updateMany` (needed here because nested relation writes
 * require the single-record `update()` API).
 */
@Injectable()
export class PrismaAppointmentRepository implements AppointmentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findList(
    tenantId: string,
    filter: AppointmentListFilter,
  ): Promise<AppointmentEntity[]> {
    const where: Prisma.AppointmentWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filter.statusIn ? { status: { in: filter.statusIn } } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.startTimeGte || filter.startTimeLte
        ? {
            startTime: {
              ...(filter.startTimeGte ? { gte: filter.startTimeGte } : {}),
              ...(filter.startTimeLte ? { lte: filter.startTimeLte } : {}),
            },
          }
        : {}),
      ...cursorWhereClause('startTime', filter.sortDirection, filter.cursor),
    };

    const rows = await this.prisma.appointment.findMany({
      where,
      include: APPOINTMENT_INCLUDE,
      orderBy: [
        { startTime: filter.sortDirection },
        { id: filter.sortDirection },
      ],
      take: filter.limit + 1,
    });

    return rows.map(toAppointmentEntity);
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<AppointmentEntity | null> {
    const row = await this.prisma.appointment.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: APPOINTMENT_INCLUDE,
    });
    return row ? toAppointmentEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: CreateAppointmentInput,
    historyAction: 'CREATED' | 'RESCHEDULED',
  ): Promise<AppointmentEntity> {
    const row = await this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          tenantId,
          customerId: input.customerId,
          employeeId: input.employeeId,
          startTime: input.startTime,
          endTime: input.endTime,
          totalPriceCents: input.totalPriceCents,
          currency: input.currency,
          notes: input.notes ?? null,
          rescheduledFromAppointmentId:
            input.rescheduledFromAppointmentId ?? null,
          services: {
            create: input.lines.map((line) => lineCreateData(tenantId, line)),
          },
        },
        include: APPOINTMENT_INCLUDE,
      });

      await tx.appointmentStatusHistory.create({
        data: {
          tenantId,
          appointmentId: appointment.id,
          action: historyAction,
          previousState: input.rescheduledFromAppointmentId
            ? {
                rescheduledFromAppointmentId:
                  input.rescheduledFromAppointmentId,
              }
            : undefined,
          newState: {
            status: appointment.status,
            startTime: appointment.startTime.toISOString(),
          },
          actorType: ActorType.USER,
          actorId: input.actorId,
        },
      });

      return appointment;
    });

    return toAppointmentEntity(row);
  }

  async updateNotes(
    tenantId: string,
    id: string,
    notes: string,
  ): Promise<AppointmentEntity> {
    const row = await this.prisma.appointment.update({
      where: { uq_appointments_tenant_id: { tenantId, id } },
      data: { notes },
      include: APPOINTMENT_INCLUDE,
    });
    return toAppointmentEntity(row);
  }

  async cancel(
    tenantId: string,
    id: string,
    input: { reason: string | null; actorId: string },
  ): Promise<AppointmentEntity> {
    const row = await this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.update({
        where: { uq_appointments_tenant_id: { tenantId, id } },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: input.reason,
          services: { updateMany: { where: {}, data: { isBlocking: false } } },
        },
        include: APPOINTMENT_INCLUDE,
      });

      await tx.appointmentStatusHistory.create({
        data: {
          tenantId,
          appointmentId: id,
          action: AppointmentHistoryAction.CANCELLED,
          newState: {
            status: 'CANCELLED',
            cancelledAt: appointment.cancelledAt?.toISOString(),
            reason: input.reason,
          },
          actorType: ActorType.USER,
          actorId: input.actorId,
        },
      });

      return appointment;
    });

    return toAppointmentEntity(row);
  }

  async reschedule(
    tenantId: string,
    originalId: string,
    newAppointment: CreateAppointmentInput,
  ): Promise<{
    original: AppointmentEntity;
    newAppointment: AppointmentEntity;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const newRow = await tx.appointment.create({
        data: {
          tenantId,
          customerId: newAppointment.customerId,
          employeeId: newAppointment.employeeId,
          startTime: newAppointment.startTime,
          endTime: newAppointment.endTime,
          totalPriceCents: newAppointment.totalPriceCents,
          currency: newAppointment.currency,
          notes: newAppointment.notes ?? null,
          rescheduledFromAppointmentId: originalId,
          services: {
            create: newAppointment.lines.map((line) =>
              lineCreateData(tenantId, line),
            ),
          },
        },
        include: APPOINTMENT_INCLUDE,
      });

      await tx.appointmentStatusHistory.create({
        data: {
          tenantId,
          appointmentId: newRow.id,
          action: AppointmentHistoryAction.RESCHEDULED,
          previousState: { rescheduledFromAppointmentId: originalId },
          newState: {
            status: newRow.status,
            startTime: newRow.startTime.toISOString(),
          },
          actorType: ActorType.USER,
          actorId: newAppointment.actorId,
        },
      });

      const originalRow = await tx.appointment.update({
        where: { uq_appointments_tenant_id: { tenantId, id: originalId } },
        data: {
          status: AppointmentStatus.RESCHEDULED,
          services: { updateMany: { where: {}, data: { isBlocking: false } } },
        },
        include: APPOINTMENT_INCLUDE,
      });

      await tx.appointmentStatusHistory.create({
        data: {
          tenantId,
          appointmentId: originalId,
          action: AppointmentHistoryAction.RESCHEDULED,
          newState: {
            status: 'RESCHEDULED',
            rescheduledToAppointmentId: newRow.id,
          },
          actorType: ActorType.USER,
          actorId: newAppointment.actorId,
        },
      });

      return { original: originalRow, newAppointment: newRow };
    });

    return {
      original: toAppointmentEntity(result.original),
      newAppointment: toAppointmentEntity(result.newAppointment),
    };
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.prisma.appointment.update({
      where: { uq_appointments_tenant_id: { tenantId, id } },
      data: {
        deletedAt: new Date(),
        services: { updateMany: { where: {}, data: { isBlocking: false } } },
      },
    });
  }
}

function lineCreateData(
  tenantId: string,
  line: AppointmentServiceLineInput,
): Prisma.AppointmentServiceUncheckedCreateWithoutAppointmentInput {
  return {
    tenantId,
    serviceId: line.serviceId,
    employeeId: line.employeeId,
    serviceNameSnapshot: line.serviceNameSnapshot,
    durationMinutesSnapshot: line.durationMinutesSnapshot,
    priceCentsSnapshot: line.priceCentsSnapshot,
    bufferMinutesSnapshot: line.bufferMinutesSnapshot,
    sequenceOrder: line.sequenceOrder,
    startTime: line.startTime,
    endTime: line.endTime,
    blockedUntil: line.blockedUntil,
  };
}
