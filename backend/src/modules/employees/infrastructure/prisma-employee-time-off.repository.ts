import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { EmployeeTimeOffEntity } from '../domain/entities/employee-time-off.entity';
import {
  CreateEmployeeTimeOffInput,
  EmployeeTimeOffRepositoryPort,
} from '../domain/ports/employee-time-off-repository.port';
import {
  isoDateStringToDate,
  toEmployeeTimeOffEntity,
} from './mappers/prisma-employee.mappers';

@Injectable()
export class PrismaEmployeeTimeOffRepository implements EmployeeTimeOffRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeTimeOffEntity[]> {
    const rows = await this.prisma.employeeTimeOff.findMany({
      where: { tenantId, employeeId },
      orderBy: { startDate: 'asc' },
    });
    return rows.map(toEmployeeTimeOffEntity);
  }

  async findByIdForEmployee(
    tenantId: string,
    employeeId: string,
    id: string,
  ): Promise<EmployeeTimeOffEntity | null> {
    const row = await this.prisma.employeeTimeOff.findFirst({
      where: { tenantId, employeeId, id },
    });
    return row ? toEmployeeTimeOffEntity(row) : null;
  }

  async create(
    tenantId: string,
    employeeId: string,
    input: CreateEmployeeTimeOffInput,
  ): Promise<EmployeeTimeOffEntity> {
    const row = await this.prisma.employeeTimeOff.create({
      data: {
        tenantId,
        employeeId,
        startDate: isoDateStringToDate(input.startDate),
        endDate: isoDateStringToDate(input.endDate),
        reason: input.reason ?? null,
      },
    });
    return toEmployeeTimeOffEntity(row);
  }

  async delete(
    tenantId: string,
    employeeId: string,
    id: string,
  ): Promise<void> {
    const { count } = await this.prisma.employeeTimeOff.deleteMany({
      where: { tenantId, employeeId, id },
    });
    if (count === 0) {
      throw new TenantResourceNotFoundException();
    }
  }
}
