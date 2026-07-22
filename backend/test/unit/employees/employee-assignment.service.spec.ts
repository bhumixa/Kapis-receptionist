import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { ServiceEntity } from '../../../src/modules/services/domain/entities/service.entity';
import { ServiceService } from '../../../src/modules/services/application/service.service';
import { EmployeeServiceRepositoryPort } from '../../../src/modules/employees/domain/ports/employee-service-repository.port';
import { EmployeeAssignmentService } from '../../../src/modules/employees/application/employee-assignment.service';
import { InvalidServiceReferenceException } from '../../../src/modules/employees/application/exceptions/employee.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeService(id: string): ServiceEntity {
  return {
    id,
    tenantId: 'tenant-1',
    categoryId: null,
    name: 'Haircut',
    description: null,
    durationMinutes: 45,
    priceCents: 8000,
    currency: 'USD',
    bufferTimeMinutes: 0,
    isActive: true,
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('EmployeeAssignmentService', () => {
  let junctionRepo: jest.Mocked<EmployeeServiceRepositoryPort>;
  let services: jest.Mocked<Pick<ServiceService, 'findByIdsForTenant'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: EmployeeAssignmentService;

  beforeEach(() => {
    junctionRepo = {
      findServiceIdsForEmployee: jest.fn(),
      findEmployeeIdsForService: jest.fn(),
      replaceForEmployee: jest.fn(),
    };
    services = { findByIdsForTenant: jest.fn() };
    auditLog = { record: jest.fn() };
    service = new EmployeeAssignmentService(
      junctionRepo,
      services as unknown as ServiceService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('assignServices', () => {
    it('rejects a serviceId that does not belong to the tenant — the composite-FK pattern application-layer half', async () => {
      services.findByIdsForTenant.mockResolvedValue([]);

      await expect(
        service.assignServices(
          'tenant-1',
          'employee-1',
          ['cross-tenant-service'],
          actor,
        ),
      ).rejects.toBeInstanceOf(InvalidServiceReferenceException);
      expect(junctionRepo.replaceForEmployee).not.toHaveBeenCalled();
    });

    it('assigns valid services and records an audit entry', async () => {
      services.findByIdsForTenant.mockResolvedValue([
        makeService('service-1'),
        makeService('service-2'),
      ]);
      junctionRepo.replaceForEmployee.mockResolvedValue([
        'service-1',
        'service-2',
      ]);

      const result = await service.assignServices(
        'tenant-1',
        'employee-1',
        ['service-1', 'service-2'],
        actor,
      );

      expect(result).toEqual(['service-1', 'service-2']);
      expect(junctionRepo.replaceForEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'employee-1',
        ['service-1', 'service-2'],
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_SERVICES_ASSIGNED' }),
      );
    });

    it('allows clearing all assignments with an empty array', async () => {
      junctionRepo.replaceForEmployee.mockResolvedValue([]);

      const result = await service.assignServices(
        'tenant-1',
        'employee-1',
        [],
        actor,
      );

      expect(result).toEqual([]);
      expect(services.findByIdsForTenant).not.toHaveBeenCalled();
    });
  });
});
