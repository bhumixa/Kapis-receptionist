import { Injectable } from '@nestjs/common';
import { ServiceCategory as PrismaServiceCategory } from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { ServiceCategoryEntity } from '../domain/entities/service-category.entity';
import {
  CreateServiceCategoryInput,
  ServiceCategoryRepositoryPort,
  UpdateServiceCategoryInput,
} from '../domain/ports/service-category-repository.port';
import { toServiceCategoryEntity } from './mappers/prisma-service.mappers';

@Injectable()
export class PrismaServiceCategoryRepository
  extends TenantScopedRepository<PrismaServiceCategory>
  implements ServiceCategoryRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.serviceCategory as unknown as TenantScopedDelegate;
  }

  async findAllForTenant(tenantId: string): Promise<ServiceCategoryEntity[]> {
    const rows = await this.findManyForTenant(
      tenantId,
      { deletedAt: null },
      { orderBy: { displayOrder: 'asc' } },
    );
    return rows.map(toServiceCategoryEntity);
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<ServiceCategoryEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {
      id,
      deletedAt: null,
    });
    return row ? toServiceCategoryEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: CreateServiceCategoryInput,
  ): Promise<ServiceCategoryEntity> {
    const row = await this.createForTenant(tenantId, {
      name: input.name,
      displayOrder: input.displayOrder ?? 0,
    });
    return toServiceCategoryEntity(row);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateServiceCategoryInput,
  ): Promise<ServiceCategoryEntity> {
    const row = await this.updateForTenant(tenantId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.displayOrder !== undefined
        ? { displayOrder: input.displayOrder }
        : {}),
    });
    return toServiceCategoryEntity(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.updateForTenant(tenantId, id, { deletedAt: new Date() });
  }
}
