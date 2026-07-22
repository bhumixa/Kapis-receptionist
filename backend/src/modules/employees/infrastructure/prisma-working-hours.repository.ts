import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { WorkingHoursEntity } from '../domain/entities/working-hours.entity';
import {
  WorkingHoursEntryInput,
  WorkingHoursRepositoryPort,
} from '../domain/ports/working-hours-repository.port';
import {
  hhMmToTime,
  toWorkingHoursEntity,
} from './mappers/prisma-employee.mappers';

/**
 * Not a `TenantScopedRepository` subclass: every operation here is scoped to
 * one employee's full set at once (`GET`/`PUT /employees/:id/working-hours`,
 * no per-row `:id` lookups exist in the API), mirroring `modules/salon`'s
 * `PrismaBusinessHoursRepository` precedent.
 */
@Injectable()
export class PrismaWorkingHoursRepository implements WorkingHoursRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<WorkingHoursEntity[]> {
    const rows = await this.prisma.workingHours.findMany({
      where: { tenantId, employeeId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(toWorkingHoursEntity);
  }

  async replaceAllForEmployee(
    tenantId: string,
    employeeId: string,
    entries: WorkingHoursEntryInput[],
  ): Promise<WorkingHoursEntity[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.workingHours.deleteMany({ where: { tenantId, employeeId } });
      if (entries.length === 0) {
        return [];
      }
      await tx.workingHours.createMany({
        data: entries.map((entry) => ({
          tenantId,
          employeeId,
          dayOfWeek: entry.dayOfWeek,
          startTime: hhMmToTime(entry.startTime),
          endTime: hhMmToTime(entry.endTime),
          isActive: entry.isActive,
        })),
      });
      return tx.workingHours.findMany({
        where: { tenantId, employeeId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
    return rows.map(toWorkingHoursEntity);
  }
}
