import { AvailabilitySlotEntity } from '../../domain/entities/availability-slot.entity';
import { AvailabilitySlotResponseDto } from '../dto/availability-slot-response.dto';

export function toAvailabilitySlotResponseDto(
  entity: AvailabilitySlotEntity,
): AvailabilitySlotResponseDto {
  return {
    employeeId: entity.employeeId,
    employeeName: entity.employeeName,
    startTime: entity.startTime.toISOString(),
    endTime: entity.endTime.toISOString(),
  };
}
