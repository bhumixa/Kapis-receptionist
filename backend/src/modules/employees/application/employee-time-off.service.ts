import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { EmployeeTimeOffEntity } from '../domain/entities/employee-time-off.entity';
import {
  EMPLOYEE_TIME_OFF_REPOSITORY,
  type CreateEmployeeTimeOffInput,
  type EmployeeTimeOffRepositoryPort,
} from '../domain/ports/employee-time-off-repository.port';
import { InvalidTimeOffRangeException } from './exceptions/employee.exceptions';

/** `GET/POST/DELETE /employees/:id/time-off[/:id]` (docs/WORKFORCE_ARCHITECTURE.md). */
@Injectable()
export class EmployeeTimeOffService {
  constructor(
    @Inject(EMPLOYEE_TIME_OFF_REPOSITORY)
    private readonly timeOff: EmployeeTimeOffRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async listTimeOff(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeTimeOffEntity[]> {
    return this.timeOff.findAllForEmployee(tenantId, employeeId);
  }

  async createTimeOff(
    tenantId: string,
    employeeId: string,
    actor: AccessTokenPayload,
    input: CreateEmployeeTimeOffInput,
  ): Promise<EmployeeTimeOffEntity> {
    if (input.endDate < input.startDate) {
      throw new InvalidTimeOffRangeException();
    }

    const entry = await this.timeOff.create(tenantId, employeeId, input);

    await this.auditLog.record({
      action: 'EMPLOYEE_TIME_OFF_CREATED',
      entityType: 'Employee',
      entityId: employeeId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { startDate: entry.startDate, endDate: entry.endDate },
    });

    return entry;
  }

  async deleteTimeOff(
    tenantId: string,
    employeeId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const current = await this.timeOff.findByIdForEmployee(
      tenantId,
      employeeId,
      id,
    );
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    await this.timeOff.delete(tenantId, employeeId, id);

    await this.auditLog.record({
      action: 'EMPLOYEE_TIME_OFF_DELETED',
      entityType: 'Employee',
      entityId: employeeId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { startDate: current.startDate, endDate: current.endDate },
    });
  }
}
