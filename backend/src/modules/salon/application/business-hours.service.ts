import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import {
  BUSINESS_HOURS_DAYS_PER_WEEK,
  BusinessHoursEntity,
} from '../domain/entities/business-hours.entity';
import {
  BUSINESS_HOURS_REPOSITORY,
  type BusinessHoursDayInput,
  type BusinessHoursRepositoryPort,
} from '../domain/ports/business-hours-repository.port';
import { InvalidBusinessHoursSetException } from './exceptions/salon.exceptions';

/**
 * `GET/PUT /salon/business-hours` (docs/SALON_ARCHITECTURE.md). A tenant
 * may not have a full 7-day set persisted yet (a brand-new tenant, or one
 * that only ever `PUT` a partial history in a pre-Milestone-4 world that
 * never existed) — `GET` fills any missing day in-memory as
 * `{isClosed:true}` without persisting anything, deliberately different
 * from `SalonProfileService`'s upsert-on-read: a 7-row set has no natural
 * single-row upsert target the way a 1:1 satellite table does.
 */
@Injectable()
export class BusinessHoursService {
  constructor(
    @Inject(BUSINESS_HOURS_REPOSITORY)
    private readonly businessHours: BusinessHoursRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async getBusinessHours(tenantId: string): Promise<BusinessHoursEntity[]> {
    const existing = await this.businessHours.findAllForTenant(tenantId);
    return fillMissingDays(tenantId, existing);
  }

  async replaceBusinessHours(
    tenantId: string,
    actor: AccessTokenPayload,
    days: BusinessHoursDayInput[],
  ): Promise<BusinessHoursEntity[]> {
    validateDaySet(days);

    const updated = await this.businessHours.replaceAll(tenantId, days);

    await this.auditLog.record({
      action: 'SALON_BUSINESS_HOURS_UPDATED',
      entityType: 'BusinessHours',
      entityId: tenantId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: {},
    });

    return updated;
  }
}

function fillMissingDays(
  tenantId: string,
  existing: BusinessHoursEntity[],
): BusinessHoursEntity[] {
  const byDay = new Map(existing.map((entry) => [entry.dayOfWeek, entry]));
  const result: BusinessHoursEntity[] = [];
  for (
    let dayOfWeek = 0;
    dayOfWeek < BUSINESS_HOURS_DAYS_PER_WEEK;
    dayOfWeek++
  ) {
    const found = byDay.get(dayOfWeek);
    result.push(
      found ?? {
        id: '',
        tenantId,
        dayOfWeek,
        startTime: '00:00',
        endTime: '00:00',
        isClosed: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    );
  }
  return result;
}

function validateDaySet(days: BusinessHoursDayInput[]): void {
  if (days.length !== BUSINESS_HOURS_DAYS_PER_WEEK) {
    throw new InvalidBusinessHoursSetException(
      `Expected exactly ${BUSINESS_HOURS_DAYS_PER_WEEK} days, received ${days.length}.`,
    );
  }

  const seen = new Set<number>();
  for (const day of days) {
    if (seen.has(day.dayOfWeek)) {
      throw new InvalidBusinessHoursSetException(
        `Duplicate dayOfWeek ${day.dayOfWeek} in business hours set.`,
      );
    }
    seen.add(day.dayOfWeek);
  }
  for (
    let dayOfWeek = 0;
    dayOfWeek < BUSINESS_HOURS_DAYS_PER_WEEK;
    dayOfWeek++
  ) {
    if (!seen.has(dayOfWeek)) {
      throw new InvalidBusinessHoursSetException(
        `Missing dayOfWeek ${dayOfWeek} — all 7 days (0-6) must be provided.`,
      );
    }
  }

  for (const day of days) {
    // Safe lexicographic comparison: both sides are DTO-validated "HH:mm" strings.
    if (!day.isClosed && day.endTime <= day.startTime) {
      throw new InvalidBusinessHoursSetException(
        `endTime must be after startTime for dayOfWeek ${day.dayOfWeek}.`,
      );
    }
  }
}
