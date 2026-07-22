import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { ServiceCategoryEntity } from '../domain/entities/service-category.entity';
import {
  SERVICE_CATEGORY_REPOSITORY,
  type CreateServiceCategoryInput,
  type ServiceCategoryRepositoryPort,
  type UpdateServiceCategoryInput,
} from '../domain/ports/service-category-repository.port';
import { NoUpdateFieldsProvidedException } from './exceptions/service.exceptions';

/** `GET/POST/PATCH/DELETE /service-categories[/:id]` (docs/SERVICE_ARCHITECTURE.md). */
@Injectable()
export class ServiceCategoryService {
  constructor(
    @Inject(SERVICE_CATEGORY_REPOSITORY)
    private readonly categories: ServiceCategoryRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async listCategories(tenantId: string): Promise<ServiceCategoryEntity[]> {
    return this.categories.findAllForTenant(tenantId);
  }

  async createCategory(
    tenantId: string,
    actor: AccessTokenPayload,
    input: CreateServiceCategoryInput,
  ): Promise<ServiceCategoryEntity> {
    const category = await this.categories.create(tenantId, input);

    await this.auditLog.record({
      action: 'SERVICE_CATEGORY_CREATED',
      entityType: 'ServiceCategory',
      entityId: category.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { name: category.name },
    });

    return category;
  }

  async updateCategory(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    input: UpdateServiceCategoryInput,
  ): Promise<ServiceCategoryEntity> {
    if (input.name === undefined && input.displayOrder === undefined) {
      throw new NoUpdateFieldsProvidedException();
    }

    const current = await this.categories.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    const updated = await this.categories.update(tenantId, id, input);

    await this.auditLog.record({
      action: 'SERVICE_CATEGORY_UPDATED',
      entityType: 'ServiceCategory',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }

  async deleteCategory(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const current = await this.categories.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    await this.categories.softDelete(tenantId, id);

    await this.auditLog.record({
      action: 'SERVICE_CATEGORY_DELETED',
      entityType: 'ServiceCategory',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { name: current.name },
    });
  }
}
