import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { BusinessHoursEntity } from '../domain/entities/business-hours.entity';
import {
  BusinessHoursDayInput,
  BusinessHoursRepositoryPort,
} from '../domain/ports/business-hours-repository.port';
import {
  hhMmToTime,
  toBusinessHoursEntity,
} from './mappers/prisma-salon.mappers';

/**
 * Not a `TenantScopedRepository` subclass: this module only ever reads/
 * writes the caller's own full week at once (`GET`/`PUT
 * /salon/business-hours`, no per-row `:id` lookups exist in the API), so
 * the base class's by-`id` helpers (`findByIdOrThrow`, `updateForTenant`)
 * have no consumer here.
 */
@Injectable()
export class PrismaBusinessHoursRepository implements BusinessHoursRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForTenant(tenantId: string): Promise<BusinessHoursEntity[]> {
    const rows = await this.prisma.businessHours.findMany({
      where: { tenantId },
      orderBy: { dayOfWeek: 'asc' },
    });
    return rows.map(toBusinessHoursEntity);
  }

  async replaceAll(
    tenantId: string,
    days: BusinessHoursDayInput[],
  ): Promise<BusinessHoursEntity[]> {
    const rows = await this.prisma.$transaction(
      days.map((day) =>
        this.prisma.businessHours.upsert({
          where: {
            uq_business_hours_tenant_day: {
              tenantId,
              dayOfWeek: day.dayOfWeek,
            },
          },
          update: {
            startTime: hhMmToTime(day.startTime),
            endTime: hhMmToTime(day.endTime),
            isClosed: day.isClosed,
          },
          create: {
            tenantId,
            dayOfWeek: day.dayOfWeek,
            startTime: hhMmToTime(day.startTime),
            endTime: hhMmToTime(day.endTime),
            isClosed: day.isClosed,
          },
        }),
      ),
    );
    return rows
      .map(toBusinessHoursEntity)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }
}
