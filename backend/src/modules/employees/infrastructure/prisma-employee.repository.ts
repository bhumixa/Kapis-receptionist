import { Injectable } from '@nestjs/common';
import { Employee as PrismaEmployeeModel, Prisma } from '@prisma/client';
import {
  TenantScopedDelegate,
  TenantScopedRepository,
} from '../../../core/database/tenant-scoped.repository';
import { PrismaService } from '../../../database/prisma.service';
import { EmployeeEntity } from '../domain/entities/employee.entity';
import {
  CreateEmployeeInput,
  EmployeeListFilter,
  EmployeeListResult,
  EmployeeRepositoryPort,
  UpdateEmployeeInput,
} from '../domain/ports/employee-repository.port';
import { toEmployeeEntity } from './mappers/prisma-employee.mappers';

@Injectable()
export class PrismaEmployeeRepository
  extends TenantScopedRepository<PrismaEmployeeModel>
  implements EmployeeRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected get delegate(): TenantScopedDelegate {
    return this.prisma.employee as unknown as TenantScopedDelegate;
  }

  async findList(
    tenantId: string,
    filter: EmployeeListFilter,
  ): Promise<EmployeeListResult> {
    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filter.status !== undefined ? { status: filter.status } : {}),
      ...(filter.employeeIdsIn !== undefined
        ? { id: { in: filter.employeeIdsIn } }
        : {}),
      ...(filter.q
        ? {
            OR: [
              { firstName: { contains: filter.q, mode: 'insensitive' } },
              { lastName: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        orderBy: { [filter.sortField]: filter.sortDirection },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { employees: rows.map(toEmployeeEntity), total };
  }

  async findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<EmployeeEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {
      id,
      deletedAt: null,
    });
    return row ? toEmployeeEntity(row) : null;
  }

  async findByUserIdForTenant(
    tenantId: string,
    userId: string,
  ): Promise<EmployeeEntity | null> {
    const row = await this.findFirstForTenant(tenantId, {
      userId,
      deletedAt: null,
    });
    return row ? toEmployeeEntity(row) : null;
  }

  async create(
    tenantId: string,
    input: CreateEmployeeInput,
  ): Promise<EmployeeEntity> {
    const row = await this.createForTenant(tenantId, {
      userId: input.userId ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      phoneNumber: input.phoneNumber ?? null,
      status: input.status ?? 'ACTIVE',
      colorTag: input.colorTag ?? null,
      bio: input.bio ?? null,
    });
    return toEmployeeEntity(row);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateEmployeeInput,
  ): Promise<EmployeeEntity> {
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(input) as (keyof UpdateEmployeeInput)[]) {
      if (input[key] !== undefined) {
        data[key] = input[key];
      }
    }
    const row = await this.updateForTenant(tenantId, id, data);
    return toEmployeeEntity(row);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.updateForTenant(tenantId, id, { deletedAt: new Date() });
  }
}
