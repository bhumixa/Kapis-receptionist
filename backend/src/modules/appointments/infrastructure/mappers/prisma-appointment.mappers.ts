import {
  Appointment as PrismaAppointment,
  AppointmentService as PrismaAppointmentService,
} from '@prisma/client';
import {
  AppointmentEntity,
  AppointmentServiceLineEntity,
} from '../../domain/entities/appointment.entity';

type PrismaAppointmentWithLines = PrismaAppointment & {
  services: PrismaAppointmentService[];
};

export function toAppointmentServiceLineEntity(
  row: PrismaAppointmentService,
): AppointmentServiceLineEntity {
  return {
    id: row.id,
    serviceId: row.serviceId,
    employeeId: row.employeeId,
    serviceNameSnapshot: row.serviceNameSnapshot,
    durationMinutesSnapshot: row.durationMinutesSnapshot,
    priceCentsSnapshot: row.priceCentsSnapshot,
    bufferMinutesSnapshot: row.bufferMinutesSnapshot,
    sequenceOrder: row.sequenceOrder,
    startTime: row.startTime,
    endTime: row.endTime,
    blockedUntil: row.blockedUntil,
    isBlocking: row.isBlocking,
  };
}

export function toAppointmentEntity(
  row: PrismaAppointmentWithLines,
): AppointmentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    employeeId: row.employeeId,
    status: row.status,
    startTime: row.startTime,
    endTime: row.endTime,
    totalPriceCents: row.totalPriceCents,
    currency: row.currency,
    notes: row.notes,
    cancellationReason: row.cancellationReason,
    cancelledAt: row.cancelledAt,
    rescheduledFromAppointmentId: row.rescheduledFromAppointmentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    services: row.services
      .slice()
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      .map(toAppointmentServiceLineEntity),
  };
}
