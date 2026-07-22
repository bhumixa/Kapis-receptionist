import { Injectable } from '@nestjs/common';
import { Holiday as PrismaHoliday } from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { PrismaService } from '../../../database/prisma.service';
import { HolidayEntity } from '../domain/entities/holiday.entity';
import {
  CreateHolidayInput,
  HolidayRepositoryPort,
  UpdateHolidayInput,
} from '../domain/ports/holiday-repository.port';
import {
  isoDateStringToDate,
  toHolidayEntity,
} from './mappers/prisma-salon.mappers';

@Injectable()
export class PrismaHolidayRepository
  extends TenantScopedRepository<PrismaHoliday>
  implements HolidayRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.holiday as unknown as TenantScopedDelegate;
  }

  async findAllForTenant(tenantId: string): Promise<HolidayEntity[]> {
    const rows = await this.findManyForTenant(
      tenantId,
      {},
      { orderBy: { date: 'asc' } },
    );
    return rows.map(toHolidayEntity);
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<HolidayEntity | null> {
    const row = await this.findFirstForTenant(tenantId, { id });
    return row ? toHolidayEntity(row) : null;
  }

  async findByDateForTenant(
    tenantId: string,
    date: string,
  ): Promise<HolidayEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {
      date: isoDateStringToDate(date),
    });
    return row ? toHolidayEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: CreateHolidayInput,
  ): Promise<HolidayEntity> {
    const row = await this.createForTenant(tenantId, {
      date: isoDateStringToDate(input.date),
      reason: input.reason,
    });
    return toHolidayEntity(row);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateHolidayInput,
  ): Promise<HolidayEntity> {
    const row = await this.updateForTenant(tenantId, id, {
      ...(input.date !== undefined
        ? { date: isoDateStringToDate(input.date) }
        : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });
    return toHolidayEntity(row);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const { count } = await this.prisma.holiday.deleteMany({
      where: { id, tenantId },
    });
    if (count === 0) {
      throw new TenantResourceNotFoundException();
    }
  }
}
