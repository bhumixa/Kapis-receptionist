import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { PrismaService } from '../../../database/prisma.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { EmployeeEntity } from '../domain/entities/employee.entity';
import {
  EMPLOYEE_REPOSITORY,
  type CreateEmployeeInput,
  type EmployeeListFilter,
  type EmployeeListResult,
  type EmployeeRepositoryPort,
  type UpdateEmployeeInput,
} from '../domain/ports/employee-repository.port';
import { EmployeeAssignmentService } from './employee-assignment.service';
import {
  InvalidUserReferenceException,
  NoUpdateFieldsProvidedException,
  UserAlreadyLinkedException,
} from './exceptions/employee.exceptions';

export interface CreateEmployeeWithServicesInput extends CreateEmployeeInput {
  serviceIds?: string[];
}

export interface UpdateEmployeeWithServicesInput extends UpdateEmployeeInput {
  serviceIds?: string[];
}

/**
 * `GET/POST/PATCH/DELETE /employees[/:id]` (docs/WORKFORCE_ARCHITECTURE.md).
 * No dedicated `Users` module exists yet in this codebase (only `Auth`,
 * which doesn't export a user-lookup service) — `userId` linkage validation
 * therefore reads `User` directly via the shared `PrismaService` (a global,
 * cross-cutting DB client from `DatabaseModule`, not another domain
 * module's private repository), a narrow, documented exception rather than
 * inventing a `Users` module solely for this one check.
 */
@Injectable()
export class EmployeeService {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY)
    private readonly employees: EmployeeRepositoryPort,
    private readonly assignments: EmployeeAssignmentService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  async listEmployees(
    tenantId: string,
    filter: EmployeeListFilter,
  ): Promise<EmployeeListResult> {
    return this.employees.findList(tenantId, filter);
  }

  async getEmployee(tenantId: string, id: string): Promise<EmployeeEntity> {
    const employee = await this.employees.findByIdForTenant(tenantId, id);
    if (!employee) {
      throw new TenantResourceNotFoundException();
    }
    return employee;
  }

  async createEmployee(
    tenantId: string,
    actor: AccessTokenPayload,
    input: CreateEmployeeWithServicesInput,
  ): Promise<EmployeeEntity> {
    if (input.userId) {
      await this.assertUserLinkable(tenantId, input.userId);
    }
    if (input.serviceIds) {
      await this.assignments.validateServiceIds(tenantId, input.serviceIds);
    }

    const employee = await this.employees.create(tenantId, input);

    if (input.serviceIds && input.serviceIds.length > 0) {
      await this.assignments.assignServices(
        tenantId,
        employee.id,
        input.serviceIds,
        actor,
      );
    }

    await this.auditLog.record({
      action: 'EMPLOYEE_CREATED',
      entityType: 'Employee',
      entityId: employee.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { firstName: employee.firstName, lastName: employee.lastName },
    });

    return employee;
  }

  async updateEmployee(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    input: UpdateEmployeeWithServicesInput,
  ): Promise<EmployeeEntity> {
    const { serviceIds, ...employeeFields } = input;
    if (Object.keys(employeeFields).length === 0 && serviceIds === undefined) {
      throw new NoUpdateFieldsProvidedException();
    }

    const current = await this.employees.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    if (employeeFields.userId && employeeFields.userId !== current.userId) {
      await this.assertUserLinkable(tenantId, employeeFields.userId);
    }

    const updated =
      Object.keys(employeeFields).length > 0
        ? await this.employees.update(tenantId, id, employeeFields)
        : current;

    if (serviceIds !== undefined) {
      await this.assignments.assignServices(tenantId, id, serviceIds, actor);
    }

    const action =
      employeeFields.status && employeeFields.status !== current.status
        ? 'EMPLOYEE_STATUS_CHANGED'
        : 'EMPLOYEE_UPDATED';

    await this.auditLog.record({
      action,
      entityType: 'Employee',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }

  async deleteEmployee(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const current = await this.employees.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    await this.employees.softDelete(tenantId, id);

    await this.auditLog.record({
      action: 'EMPLOYEE_DELETED',
      entityType: 'Employee',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { firstName: current.firstName, lastName: current.lastName },
    });
  }

  private async assertUserLinkable(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
    });
    if (!user) {
      throw new InvalidUserReferenceException();
    }

    const existingLink = await this.employees.findByUserIdForTenant(
      tenantId,
      userId,
    );
    if (existingLink) {
      throw new UserAlreadyLinkedException();
    }
  }
}
