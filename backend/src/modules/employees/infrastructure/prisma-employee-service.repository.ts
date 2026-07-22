import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { EmployeeServiceRepositoryPort } from '../domain/ports/employee-service-repository.port';

/**
 * The `EmployeeService` junction repository — writes rely on the compound
 * FK (`(tenantId, employeeId) REFERENCES employees(tenantId, id)`, same for
 * `serviceId`/`services`) declared in `schema.prisma` to reject a
 * cross-tenant pairing at the database level, not just the application
 * layer (docs/TENANT_ARCHITECTURE.md Section 4.1).
 */
@Injectable()
export class PrismaEmployeeServiceRepository implements EmployeeServiceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findServiceIdsForEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.employeeService.findMany({
      where: { tenantId, employeeId },
      select: { serviceId: true },
    });
    return rows.map((row) => row.serviceId);
  }

  async findEmployeeIdsForService(
    tenantId: string,
    serviceId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.employeeService.findMany({
      where: { tenantId, serviceId },
      select: { employeeId: true },
    });
    return rows.map((row) => row.employeeId);
  }

  async replaceForEmployee(
    tenantId: string,
    employeeId: string,
    serviceIds: string[],
  ): Promise<string[]> {
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeService.deleteMany({ where: { tenantId, employeeId } });
      if (serviceIds.length > 0) {
        await tx.employeeService.createMany({
          data: serviceIds.map((serviceId) => ({
            tenantId,
            employeeId,
            serviceId,
          })),
        });
      }
    });
    return serviceIds;
  }
}
