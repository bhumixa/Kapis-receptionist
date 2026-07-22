import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { WorkingHoursEntity } from '../../../src/modules/employees/domain/entities/working-hours.entity';
import {
  WorkingHoursEntryInput,
  WorkingHoursRepositoryPort,
} from '../../../src/modules/employees/domain/ports/working-hours-repository.port';
import { WorkingHoursService } from '../../../src/modules/employees/application/working-hours.service';
import { InvalidWorkingHoursEntryException } from '../../../src/modules/employees/application/exceptions/employee.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeEntry(
  overrides: Partial<WorkingHoursEntryInput> = {},
): WorkingHoursEntryInput {
  return {
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
    ...overrides,
  };
}

function toEntities(entries: WorkingHoursEntryInput[]): WorkingHoursEntity[] {
  return entries.map((entry, index) => ({
    id: `wh-${index}`,
    tenantId: 'tenant-1',
    employeeId: 'employee-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...entry,
  }));
}

describe('WorkingHoursService', () => {
  let repo: jest.Mocked<WorkingHoursRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: WorkingHoursService;

  beforeEach(() => {
    repo = {
      findAllForEmployee: jest.fn(),
      replaceAllForEmployee: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new WorkingHoursService(
      repo,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('replaceWorkingHours', () => {
    it('rejects an out-of-range dayOfWeek', async () => {
      await expect(
        service.replaceWorkingHours('tenant-1', 'employee-1', actor, [
          makeEntry({ dayOfWeek: 7 }),
        ]),
      ).rejects.toBeInstanceOf(InvalidWorkingHoursEntryException);
      expect(repo.replaceAllForEmployee).not.toHaveBeenCalled();
    });

    it('rejects endTime <= startTime for an active entry', async () => {
      await expect(
        service.replaceWorkingHours('tenant-1', 'employee-1', actor, [
          makeEntry({ startTime: '17:00', endTime: '09:00' }),
        ]),
      ).rejects.toBeInstanceOf(InvalidWorkingHoursEntryException);
      expect(repo.replaceAllForEmployee).not.toHaveBeenCalled();
    });

    it('allows multiple entries on the same day (split shifts)', async () => {
      const entries = [
        makeEntry({ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }),
        makeEntry({ dayOfWeek: 1, startTime: '13:00', endTime: '17:00' }),
      ];
      repo.replaceAllForEmployee.mockResolvedValue(toEntities(entries));

      const result = await service.replaceWorkingHours(
        'tenant-1',
        'employee-1',
        actor,
        entries,
      );

      expect(result).toHaveLength(2);
      expect(repo.replaceAllForEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'employee-1',
        entries,
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_WORKING_HOURS_UPDATED' }),
      );
    });

    it('allows clearing all entries (a day off)', async () => {
      repo.replaceAllForEmployee.mockResolvedValue([]);

      const result = await service.replaceWorkingHours(
        'tenant-1',
        'employee-1',
        actor,
        [],
      );

      expect(result).toEqual([]);
    });
  });
});
