import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { EmployeeTimeOffEntity } from '../../../src/modules/employees/domain/entities/employee-time-off.entity';
import { EmployeeTimeOffRepositoryPort } from '../../../src/modules/employees/domain/ports/employee-time-off-repository.port';
import { EmployeeTimeOffService } from '../../../src/modules/employees/application/employee-time-off.service';
import { InvalidTimeOffRangeException } from '../../../src/modules/employees/application/exceptions/employee.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeTimeOff(
  overrides: Partial<EmployeeTimeOffEntity> = {},
): EmployeeTimeOffEntity {
  return {
    id: 'time-off-1',
    tenantId: 'tenant-1',
    employeeId: 'employee-1',
    startDate: '2026-08-01',
    endDate: '2026-08-07',
    reason: 'Annual leave',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('EmployeeTimeOffService', () => {
  let repo: jest.Mocked<EmployeeTimeOffRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: EmployeeTimeOffService;

  beforeEach(() => {
    repo = {
      findAllForEmployee: jest.fn(),
      findByIdForEmployee: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new EmployeeTimeOffService(
      repo,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('createTimeOff', () => {
    it('rejects endDate before startDate', async () => {
      await expect(
        service.createTimeOff('tenant-1', 'employee-1', actor, {
          startDate: '2026-08-10',
          endDate: '2026-08-01',
        }),
      ).rejects.toBeInstanceOf(InvalidTimeOffRangeException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows a single-day range (startDate === endDate)', async () => {
      repo.create.mockResolvedValue(
        makeTimeOff({ startDate: '2026-08-01', endDate: '2026-08-01' }),
      );

      const result = await service.createTimeOff(
        'tenant-1',
        'employee-1',
        actor,
        { startDate: '2026-08-01', endDate: '2026-08-01' },
      );

      expect(result.startDate).toBe('2026-08-01');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_TIME_OFF_CREATED' }),
      );
    });
  });

  describe('deleteTimeOff', () => {
    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant entry', async () => {
      repo.findByIdForEmployee.mockResolvedValue(null);

      await expect(
        service.deleteTimeOff('tenant-1', 'employee-1', 'ghost', actor),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('deletes and records an audit entry', async () => {
      repo.findByIdForEmployee.mockResolvedValue(makeTimeOff());

      await service.deleteTimeOff(
        'tenant-1',
        'employee-1',
        'time-off-1',
        actor,
      );

      expect(repo.delete).toHaveBeenCalledWith(
        'tenant-1',
        'employee-1',
        'time-off-1',
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_TIME_OFF_DELETED' }),
      );
    });
  });
});
