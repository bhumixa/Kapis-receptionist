import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { HolidayEntity } from '../domain/entities/holiday.entity';
import {
  HOLIDAY_REPOSITORY,
  type CreateHolidayInput,
  type HolidayRepositoryPort,
  type UpdateHolidayInput,
} from '../domain/ports/holiday-repository.port';
import {
  DuplicateHolidayDateException,
  NoUpdateFieldsProvidedException,
} from './exceptions/salon.exceptions';

/** `GET/POST/PATCH/DELETE /salon/holidays[/:id]` (docs/SALON_ARCHITECTURE.md). Tenant-wide only this milestone — no `employeeId`/`branchId`. */
@Injectable()
export class HolidayService {
  constructor(
    @Inject(HOLIDAY_REPOSITORY)
    private readonly holidays: HolidayRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async listHolidays(tenantId: string): Promise<HolidayEntity[]> {
    return this.holidays.findAllForTenant(tenantId);
  }

  async createHoliday(
    tenantId: string,
    actor: AccessTokenPayload,
    input: CreateHolidayInput,
  ): Promise<HolidayEntity> {
    const existing = await this.holidays.findByDateForTenant(
      tenantId,
      input.date,
    );
    if (existing) {
      throw new DuplicateHolidayDateException(input.date);
    }

    const holiday = await this.holidays.create(tenantId, input);

    await this.auditLog.record({
      action: 'SALON_HOLIDAY_CREATED',
      entityType: 'Holiday',
      entityId: holiday.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { date: holiday.date, reason: holiday.reason },
    });

    return holiday;
  }

  async updateHoliday(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    input: UpdateHolidayInput,
  ): Promise<HolidayEntity> {
    if (input.date === undefined && input.reason === undefined) {
      throw new NoUpdateFieldsProvidedException();
    }

    const current = await this.holidays.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    if (input.date !== undefined && input.date !== current.date) {
      const clashing = await this.holidays.findByDateForTenant(
        tenantId,
        input.date,
      );
      if (clashing) {
        throw new DuplicateHolidayDateException(input.date);
      }
    }

    const updated = await this.holidays.update(tenantId, id, input);

    await this.auditLog.record({
      action: 'SALON_HOLIDAY_UPDATED',
      entityType: 'Holiday',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }

  async deleteHoliday(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const current = await this.holidays.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    await this.holidays.delete(tenantId, id);

    await this.auditLog.record({
      action: 'SALON_HOLIDAY_DELETED',
      entityType: 'Holiday',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { date: current.date, reason: current.reason },
    });
  }
}
