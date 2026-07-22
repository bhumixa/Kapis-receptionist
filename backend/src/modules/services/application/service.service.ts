import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { ServiceEntity } from '../domain/entities/service.entity';
import {
  SERVICE_CATEGORY_REPOSITORY,
  type ServiceCategoryRepositoryPort,
} from '../domain/ports/service-category-repository.port';
import {
  SERVICE_REPOSITORY,
  type CreateServiceInput,
  type ServiceListFilter,
  type ServiceListResult,
  type ServiceRepositoryPort,
  type UpdateServiceInput,
} from '../domain/ports/service-repository.port';
import {
  InvalidCategoryReferenceException,
  NoUpdateFieldsProvidedException,
} from './exceptions/service.exceptions';

/**
 * `GET/POST/PATCH/DELETE /services[/:id]` (docs/SERVICE_ARCHITECTURE.md).
 * Also the module's public surface consumed by `modules/employees`
 * (`findByIdsForTenant`) to validate `serviceIds` without that module
 * reaching into this module's Prisma model directly (module-boundary rule,
 * SYSTEM_ARCHITECTURE.md Section 2.3) — the one-directional dependency
 * decided in docs/adr/ADR-008-workforce-and-service-catalog.md.
 */
@Injectable()
export class ServiceService {
  constructor(
    @Inject(SERVICE_REPOSITORY)
    private readonly services: ServiceRepositoryPort,
    @Inject(SERVICE_CATEGORY_REPOSITORY)
    private readonly categories: ServiceCategoryRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async listServices(
    tenantId: string,
    filter: ServiceListFilter,
  ): Promise<ServiceListResult> {
    return this.services.findList(tenantId, filter);
  }

  async getService(tenantId: string, id: string): Promise<ServiceEntity> {
    const service = await this.services.findByIdForTenant(tenantId, id);
    if (!service) {
      throw new TenantResourceNotFoundException();
    }
    return service;
  }

  /** Validates every id belongs to the tenant; throws if any is missing. Used by `modules/employees`. */
  async findByIdsForTenant(
    tenantId: string,
    ids: string[],
  ): Promise<ServiceEntity[]> {
    return this.services.findByIdsForTenant(tenantId, ids);
  }

  async createService(
    tenantId: string,
    actor: AccessTokenPayload,
    input: CreateServiceInput,
  ): Promise<ServiceEntity> {
    if (input.categoryId) {
      await this.assertCategoryBelongsToTenant(tenantId, input.categoryId);
    }

    const service = await this.services.create(tenantId, input);

    await this.auditLog.record({
      action: 'SERVICE_CREATED',
      entityType: 'Service',
      entityId: service.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { name: service.name },
    });

    return service;
  }

  async updateService(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    input: UpdateServiceInput,
  ): Promise<ServiceEntity> {
    if (Object.keys(input).length === 0) {
      throw new NoUpdateFieldsProvidedException();
    }

    const current = await this.services.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    if (input.categoryId) {
      await this.assertCategoryBelongsToTenant(tenantId, input.categoryId);
    }

    const updated = await this.services.update(tenantId, id, input);

    await this.auditLog.record({
      action: 'SERVICE_UPDATED',
      entityType: 'Service',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }

  async deleteService(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const current = await this.services.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    await this.services.softDelete(tenantId, id);

    await this.auditLog.record({
      action: 'SERVICE_DELETED',
      entityType: 'Service',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { name: current.name },
    });
  }

  private async assertCategoryBelongsToTenant(
    tenantId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.categories.findByIdForTenant(
      tenantId,
      categoryId,
    );
    if (!category) {
      throw new InvalidCategoryReferenceException(categoryId);
    }
  }
}
