import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { WorkingHoursEntity } from '../domain/entities/working-hours.entity';
import {
  WORKING_HOURS_REPOSITORY,
  type WorkingHoursEntryInput,
  type WorkingHoursRepositoryPort,
} from '../domain/ports/working-hours-repository.port';
import { InvalidWorkingHoursEntryException } from './exceptions/employee.exceptions';

const VALID_DAYS_OF_WEEK = new Set([0, 1, 2, 3, 4, 5, 6]);

/**
 * `GET/PUT /employees/:id/working-hours` (docs/WORKFORCE_ARCHITECTURE.md) —
 * a recurring weekly schedule template per employee. Unlike the salon-wide
 * `BusinessHours` (exactly 7 entries, one per day), this allows any number
 * of entries per day (split shifts) or zero entries for a day off, so
 * there's no "exactly 7" contract to enforce — only per-entry sanity.
 */
@Injectable()
export class WorkingHoursService {
  constructor(
    @Inject(WORKING_HOURS_REPOSITORY)
    private readonly workingHours: WorkingHoursRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async getWorkingHours(
    tenantId: string,
    employeeId: string,
  ): Promise<WorkingHoursEntity[]> {
    return this.workingHours.findAllForEmployee(tenantId, employeeId);
  }

  async replaceWorkingHours(
    tenantId: string,
    employeeId: string,
    actor: AccessTokenPayload,
    entries: WorkingHoursEntryInput[],
  ): Promise<WorkingHoursEntity[]> {
    validateEntries(entries);

    const updated = await this.workingHours.replaceAllForEmployee(
      tenantId,
      employeeId,
      entries,
    );

    await this.auditLog.record({
      action: 'EMPLOYEE_WORKING_HOURS_UPDATED',
      entityType: 'Employee',
      entityId: employeeId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { entryCount: entries.length },
    });

    return updated;
  }
}

function validateEntries(entries: WorkingHoursEntryInput[]): void {
  for (const entry of entries) {
    if (!VALID_DAYS_OF_WEEK.has(entry.dayOfWeek)) {
      throw new InvalidWorkingHoursEntryException(
        `dayOfWeek must be 0-6, received ${entry.dayOfWeek}.`,
      );
    }
    if (entry.isActive && entry.endTime <= entry.startTime) {
      throw new InvalidWorkingHoursEntryException(
        `endTime must be after startTime for dayOfWeek ${entry.dayOfWeek}.`,
      );
    }
  }
}
