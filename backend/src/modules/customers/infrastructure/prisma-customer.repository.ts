import { Injectable } from '@nestjs/common';
import { Customer as PrismaCustomerModel, Prisma } from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { cursorWhereClause } from '../../../common/utils/cursor-pagination.util';
import { CustomerEntity } from '../domain/entities/customer.entity';
import {
  CreateCustomerInput,
  CustomerListFilter,
  CustomerRepositoryPort,
  UpdateCustomerInput,
} from '../domain/ports/customer-repository.port';
import { toCustomerEntity } from './mappers/prisma-customer.mappers';

@Injectable()
export class PrismaCustomerRepository
  extends TenantScopedRepository<PrismaCustomerModel>
  implements CustomerRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.customer as unknown as TenantScopedDelegate;
  }

  async findList(
    tenantId: string,
    filter: CustomerListFilter,
  ): Promise<CustomerEntity[]> {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filter.marketingOptIn !== undefined
        ? { marketingOptIn: filter.marketingOptIn }
        : {}),
      ...(filter.q
        ? {
            OR: [
              { firstName: { contains: filter.q, mode: 'insensitive' } },
              { lastName: { contains: filter.q, mode: 'insensitive' } },
              { phoneNumber: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...cursorWhereClause(
        filter.sortField,
        filter.sortDirection,
        filter.cursor,
      ),
    };

    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: [
        { [filter.sortField]: filter.sortDirection },
        { id: filter.sortDirection },
      ],
      take: filter.limit + 1,
    });

    return rows.map(toCustomerEntity);
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<CustomerEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {
      id,
      deletedAt: null,
    });
    return row ? toCustomerEntity(row) : null;
  }

  async findByIdsForTenant(
    tenantId: string,
    ids: string[],
  ): Promise<CustomerEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.findManyForTenant(tenantId, {
      id: { in: ids },
      deletedAt: null,
    });
    return rows.map(toCustomerEntity);
  }

  async findByPhoneForTenant(
    tenantId: string,
    phoneNumber: string,
  ): Promise<CustomerEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {
      phoneNumber,
      deletedAt: null,
    });
    return row ? toCustomerEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: CreateCustomerInput,
  ): Promise<CustomerEntity> {
    const row = await this.createForTenant(tenantId, {
      phoneNumber: input.phoneNumber,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      email: input.email ?? null,
      preferredLanguage: input.preferredLanguage ?? null,
      marketingOptIn: input.marketingOptIn ?? false,
    });
    return toCustomerEntity(row);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerEntity> {
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(input) as (keyof UpdateCustomerInput)[]) {
      if (input[key] !== undefined) {
        data[key] = input[key];
      }
    }
    const row = await this.updateForTenant(tenantId, id, data);
    return toCustomerEntity(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.updateForTenant(tenantId, id, { deletedAt: new Date() });
  }
}
