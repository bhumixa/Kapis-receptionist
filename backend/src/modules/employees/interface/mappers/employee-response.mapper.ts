import { EmployeeEntity } from '../../domain/entities/employee.entity';
import { EmployeeTimeOffEntity } from '../../domain/entities/employee-time-off.entity';
import { WorkingHoursEntity } from '../../domain/entities/working-hours.entity';
import { EmployeeResponseDto } from '../dto/employee-response.dto';
import { TimeOffResponseDto } from '../dto/time-off-response.dto';
import { WorkingHoursResponseDto } from '../dto/working-hours-response.dto';

export function toEmployeeResponseDto(
  entity: EmployeeEntity,
  serviceIds: string[],
): EmployeeResponseDto {
  return {
    id: entity.id,
    userId: entity.userId,
    firstName: entity.firstName,
    lastName: entity.lastName,
    phoneNumber: entity.phoneNumber,
    status: entity.status,
    colorTag: entity.colorTag,
    bio: entity.bio,
    serviceIds,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toWorkingHoursResponseDto(
  entity: WorkingHoursEntity,
): WorkingHoursResponseDto {
  return {
    dayOfWeek: entity.dayOfWeek,
    startTime: entity.startTime,
    endTime: entity.endTime,
    isActive: entity.isActive,
  };
}

export function toTimeOffResponseDto(
  entity: EmployeeTimeOffEntity,
): TimeOffResponseDto {
  return {
    id: entity.id,
    startDate: entity.startDate,
    endDate: entity.endDate,
    reason: entity.reason,
    createdAt: entity.createdAt.toISOString(),
  };
}
