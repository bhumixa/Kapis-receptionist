import { Injectable } from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { TenantEntity } from '../domain/entities/tenant.entity';
import {
  AdminTenantListFilter,
  AdminTenantListResult,
  TenantRepositoryPort,
  UpdateTenantProfileInput,
} from '../domain/ports/tenant-repository.port';
import { toTenantEntity } from './mappers/prisma-tenant.mappers';

/**
 * The Tenants module's own `Tenant` repository — not a `TenantScopedRepository`
 * subclass, since `Tenant` is the tenant root itself (it has no `tenantId`
 * column to scope by; its own `id` *is* the tenant identity).
 */
@Injectable()
export class PrismaTenantRepository implements TenantRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<TenantEntity | null> {
    const row = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toTenantEntity(row) : null;
  }

  async updateProfile(
    id: string,
    input: UpdateTenantProfileInput,
    tx?: Prisma.TransactionClient,
  ): Promise<TenantEntity> {
    const row = await (tx ?? this.prisma).tenant.update({
      where: { id },
      data: input,
    });
    return toTenantEntity(row);
  }

  async updateStatus(
    id: string,
    status: TenantStatus,
    extra?: { suspendedAt?: Date | null },
  ): Promise<TenantEntity> {
    const row = await this.prisma.tenant.update({
      where: { id },
      data: { status, ...(extra ?? {}) },
    });
    return toTenantEntity(row);
  }

  async findManyForAdmin(
    filter: AdminTenantListFilter,
  ): Promise<AdminTenantListResult> {
    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { slug: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { tenants: rows.map(toTenantEntity), total };
  }
}
