import { EmployeeStatus, RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { PrismaService } from '../../../src/database/prisma.service';
import { EmployeeEntity } from '../../../src/modules/employees/domain/entities/employee.entity';
import { EmployeeRepositoryPort } from '../../../src/modules/employees/domain/ports/employee-repository.port';
import { EmployeeAssignmentService } from '../../../src/modules/employees/application/employee-assignment.service';
import { EmployeeService } from '../../../src/modules/employees/application/employee.service';
import {
  InvalidUserReferenceException,
  NoUpdateFieldsProvidedException,
  UserAlreadyLinkedException,
} from '../../../src/modules/employees/application/exceptions/employee.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeEmployee(overrides: Partial<EmployeeEntity> = {}): EmployeeEntity {
  return {
    id: 'employee-1',
    tenantId: 'tenant-1',
    userId: null,
    firstName: 'Ana',
    lastName: 'Silva',
    phoneNumber: null,
    status: EmployeeStatus.ACTIVE,
    colorTag: null,
    bio: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('EmployeeService', () => {
  let repo: jest.Mocked<EmployeeRepositoryPort>;
  let assignments: jest.Mocked<
    Pick<EmployeeAssignmentService, 'validateServiceIds' | 'assignServices'>
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let prisma: { user: { findFirst: jest.Mock } };
  let service: EmployeeService;

  beforeEach(() => {
    repo = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      findByUserIdForTenant: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    assignments = {
      validateServiceIds: jest.fn(),
      assignServices: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    prisma = { user: { findFirst: jest.fn() } };
    service = new EmployeeService(
      repo,
      assignments as unknown as EmployeeAssignmentService,
      auditLog as unknown as AuditLogService,
      prisma as unknown as PrismaService,
    );
  });

  describe('createEmployee', () => {
    it('creates an employee and records an audit entry', async () => {
      repo.create.mockResolvedValue(makeEmployee());

      const result = await service.createEmployee('tenant-1', actor, {
        firstName: 'Ana',
        lastName: 'Silva',
      });

      expect(result.id).toBe('employee-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_CREATED' }),
      );
    });

    it('validates userId references an existing user in the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.createEmployee('tenant-1', actor, {
          firstName: 'Ana',
          lastName: 'Silva',
          userId: 'cross-tenant-user',
        }),
      ).rejects.toBeInstanceOf(InvalidUserReferenceException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a userId already linked to another employee', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });
      repo.findByUserIdForTenant.mockResolvedValue(
        makeEmployee({ id: 'employee-2', userId: 'user-2' }),
      );

      await expect(
        service.createEmployee('tenant-1', actor, {
          firstName: 'Ana',
          lastName: 'Silva',
          userId: 'user-2',
        }),
      ).rejects.toBeInstanceOf(UserAlreadyLinkedException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('validates serviceIds and assigns them after creation', async () => {
      repo.create.mockResolvedValue(makeEmployee());
      assignments.assignServices.mockResolvedValue(['service-1']);

      await service.createEmployee('tenant-1', actor, {
        firstName: 'Ana',
        lastName: 'Silva',
        serviceIds: ['service-1'],
      });

      expect(assignments.validateServiceIds).toHaveBeenCalledWith('tenant-1', [
        'service-1',
      ]);
      expect(assignments.assignServices).toHaveBeenCalledWith(
        'tenant-1',
        'employee-1',
        ['service-1'],
        actor,
      );
    });
  });

  describe('updateEmployee', () => {
    it('rejects an update with no fields and no serviceIds provided', async () => {
      await expect(
        service.updateEmployee('tenant-1', 'employee-1', actor, {}),
      ).rejects.toBeInstanceOf(NoUpdateFieldsProvidedException);
      expect(repo.findByIdForTenant).not.toHaveBeenCalled();
    });

    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant employee', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.updateEmployee('tenant-1', 'ghost', actor, {
          firstName: 'x',
        }),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
    });

    it('records EMPLOYEE_STATUS_CHANGED when status transitions', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeEmployee());
      repo.update.mockResolvedValue(
        makeEmployee({ status: EmployeeStatus.ON_LEAVE }),
      );

      await service.updateEmployee('tenant-1', 'employee-1', actor, {
        status: EmployeeStatus.ON_LEAVE,
      });

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_STATUS_CHANGED' }),
      );
    });

    it('records EMPLOYEE_UPDATED for a non-status field change', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeEmployee());
      repo.update.mockResolvedValue(makeEmployee({ bio: 'Updated bio' }));

      await service.updateEmployee('tenant-1', 'employee-1', actor, {
        bio: 'Updated bio',
      });

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_UPDATED' }),
      );
    });

    it('reassigns services via serviceIds without requiring any other field', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeEmployee());
      assignments.assignServices.mockResolvedValue([]);

      await service.updateEmployee('tenant-1', 'employee-1', actor, {
        serviceIds: [],
      });

      expect(repo.update).not.toHaveBeenCalled();
      expect(assignments.assignServices).toHaveBeenCalledWith(
        'tenant-1',
        'employee-1',
        [],
        actor,
      );
    });
  });

  describe('deleteEmployee', () => {
    it('soft-deletes and records an audit entry', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeEmployee());

      await service.deleteEmployee('tenant-1', 'employee-1', actor);

      expect(repo.softDelete).toHaveBeenCalledWith('tenant-1', 'employee-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_DELETED' }),
      );
    });
  });
});
