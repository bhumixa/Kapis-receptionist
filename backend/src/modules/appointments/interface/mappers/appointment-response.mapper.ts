import { AppointmentEntity } from '../../domain/entities/appointment.entity';
import { AppointmentResponseDto } from '../dto/appointment-response.dto';

export function toAppointmentResponseDto(
  entity: AppointmentEntity,
): AppointmentResponseDto {
  return {
    id: entity.id,
    customerId: entity.customerId,
    employeeId: entity.employeeId,
    status: entity.status,
    startTime: entity.startTime.toISOString(),
    endTime: entity.endTime.toISOString(),
    totalPriceCents: entity.totalPriceCents,
    currency: entity.currency,
    notes: entity.notes,
    cancellationReason: entity.cancellationReason,
    cancelledAt: entity.cancelledAt ? entity.cancelledAt.toISOString() : null,
    rescheduledFromAppointmentId: entity.rescheduledFromAppointmentId,
    services: entity.services.map((line) => ({
      id: line.id,
      serviceId: line.serviceId,
      employeeId: line.employeeId,
      serviceNameSnapshot: line.serviceNameSnapshot,
      durationMinutesSnapshot: line.durationMinutesSnapshot,
      priceCentsSnapshot: line.priceCentsSnapshot,
      bufferMinutesSnapshot: line.bufferMinutesSnapshot,
      sequenceOrder: line.sequenceOrder,
      startTime: line.startTime.toISOString(),
      endTime: line.endTime.toISOString(),
    })),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
