import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { ServiceService } from '../../services/application/service.service';
import {
  EMPLOYEE_SERVICE_REPOSITORY,
  type EmployeeServiceRepositoryPort,
} from '../domain/ports/employee-service-repository.port';
import { InvalidServiceReferenceException } from './exceptions/employee.exceptions';

/**
 * `PUT /employees/:id/services` (docs/WORKFORCE_ARCHITECTURE.md) — the
 * Employee ↔ Service assignment mutation. Validates every `serviceId`
 * belongs to the tenant via the injected `ServiceService` (`modules/
 * services`' exported application service — never this module reaching
 * into `Service`'s Prisma model directly, per the module-boundary rule),
 * the one-directional Employees → Services dependency decided in
 * docs/adr/ADR-008-workforce-and-service-catalog.md.
 */
@Injectable()
export class EmployeeAssignmentService {
  constructor(
    @Inject(EMPLOYEE_SERVICE_REPOSITORY)
    private readonly employeeServices: EmployeeServiceRepositoryPort,
    private readonly services: ServiceService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getServiceIdsForEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<string[]> {
    return this.employeeServices.findServiceIdsForEmployee(
      tenantId,
      employeeId,
    );
  }

  async getEmployeeIdsForService(
    tenantId: string,
    serviceId: string,
  ): Promise<string[]> {
    return this.employeeServices.findEmployeeIdsForService(tenantId, serviceId);
  }

  async assignServices(
    tenantId: string,
    employeeId: string,
    serviceIds: string[],
    actor: AccessTokenPayload,
  ): Promise<string[]> {
    await this.validateServiceIds(tenantId, serviceIds);

    const assigned = await this.employeeServices.replaceForEmployee(
      tenantId,
      employeeId,
      serviceIds,
    );

    await this.auditLog.record({
      action: 'EMPLOYEE_SERVICES_ASSIGNED',
      entityType: 'Employee',
      entityId: employeeId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { serviceIds: assigned },
    });

    return assigned;
  }

  async validateServiceIds(
    tenantId: string,
    serviceIds: string[],
  ): Promise<void> {
    if (serviceIds.length === 0) {
      return;
    }
    const found = await this.services.findByIdsForTenant(tenantId, serviceIds);
    if (found.length !== new Set(serviceIds).size) {
      const foundIds = new Set(found.map((service) => service.id));
      const missing = serviceIds.filter((id) => !foundIds.has(id));
      throw new InvalidServiceReferenceException(missing);
    }
  }
}
