import { Injectable } from '@nestjs/common';
import { Prisma, Service as PrismaServiceModel } from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { ServiceEntity } from '../domain/entities/service.entity';
import {
  CreateServiceInput,
  ServiceListFilter,
  ServiceListResult,
  ServiceRepositoryPort,
  UpdateServiceInput,
} from '../domain/ports/service-repository.port';
import { toServiceEntity } from './mappers/prisma-service.mappers';

@Injectable()
export class PrismaServiceRepository
  extends TenantScopedRepository<PrismaServiceModel>
  implements ServiceRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.service as unknown as TenantScopedDelegate;
  }

  async findList(
    tenantId: string,
    filter: ServiceListFilter,
  ): Promise<ServiceListResult> {
    const where: Prisma.ServiceWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      ...(filter.categoryId !== undefined
        ? { categoryId: filter.categoryId }
        : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { description: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        orderBy: { [filter.sortField]: filter.sortDirection },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.service.count({ where }),
    ]);

    return { services: rows.map(toServiceEntity), total };
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<ServiceEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {
      id,
      deletedAt: null,
    });
    return row ? toServiceEntity(row) : null;
  }

  async findByIdsForTenant(
    tenantId: string,
    ids: string[],
  ): Promise<ServiceEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.findManyForTenant(tenantId, {
      id: { in: ids },
      deletedAt: null,
    });
    return rows.map(toServiceEntity);
  }

  async create(
    tenantId: string,
    input: CreateServiceInput,
  ): Promise<ServiceEntity> {
    const row = await this.createForTenant(tenantId, {
      categoryId: input.categoryId ?? null,
      name: input.name,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      priceCents: input.priceCents,
      currency: input.currency ?? 'USD',
      bufferTimeMinutes: input.bufferTimeMinutes ?? 0,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
    });
    return toServiceEntity(row);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateServiceInput,
  ): Promise<ServiceEntity> {
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(input) as (keyof UpdateServiceInput)[]) {
      if (input[key] !== undefined) {
        data[key] = input[key];
      }
    }
    const row = await this.updateForTenant(tenantId, id, data);
    return toServiceEntity(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.updateForTenant(tenantId, id, { deletedAt: new Date() });
  }
}
