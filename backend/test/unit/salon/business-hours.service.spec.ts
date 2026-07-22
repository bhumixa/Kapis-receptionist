import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { BusinessHoursEntity } from '../../../src/modules/salon/domain/entities/business-hours.entity';
import {
  BusinessHoursDayInput,
  BusinessHoursRepositoryPort,
} from '../../../src/modules/salon/domain/ports/business-hours-repository.port';
import { BusinessHoursService } from '../../../src/modules/salon/application/business-hours.service';
import { InvalidBusinessHoursSetException } from '../../../src/modules/salon/application/exceptions/salon.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeDay(
  overrides: Partial<BusinessHoursDayInput> = {},
): BusinessHoursDayInput {
  return {
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
    isClosed: false,
    ...overrides,
  };
}

function fullWeek(): BusinessHoursDayInput[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => makeDay({ dayOfWeek }));
}

function toEntities(days: BusinessHoursDayInput[]): BusinessHoursEntity[] {
  return days.map((day, index) => ({
    id: `bh-${index}`,
    tenantId: 'tenant-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...day,
  }));
}

describe('BusinessHoursService', () => {
  let repo: jest.Mocked<BusinessHoursRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: BusinessHoursService;

  beforeEach(() => {
    repo = {
      findAllForTenant: jest.fn(),
      replaceAll: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new BusinessHoursService(
      repo,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('getBusinessHours', () => {
    it('fills missing days in-memory as closed, without persisting anything', async () => {
      repo.findAllForTenant.mockResolvedValue(
        toEntities([makeDay({ dayOfWeek: 1 })]),
      );

      const result = await service.getBusinessHours('tenant-1');

      expect(result).toHaveLength(7);
      expect(result[0]).toMatchObject({ dayOfWeek: 0, isClosed: true });
      expect(result[1]).toMatchObject({
        dayOfWeek: 1,
        isClosed: false,
        startTime: '09:00',
      });
      expect(repo.replaceAll).not.toHaveBeenCalled();
    });
  });

  describe('replaceBusinessHours', () => {
    it('rejects a set that is not exactly 7 days', async () => {
      await expect(
        service.replaceBusinessHours('tenant-1', actor, fullWeek().slice(0, 6)),
      ).rejects.toBeInstanceOf(InvalidBusinessHoursSetException);
      expect(repo.replaceAll).not.toHaveBeenCalled();
    });

    it('rejects a set with duplicate/missing dayOfWeek values', async () => {
      const days = fullWeek();
      days[6] = { ...days[6], dayOfWeek: 5 }; // duplicates day 5, day 6 now missing
      await expect(
        service.replaceBusinessHours('tenant-1', actor, days),
      ).rejects.toBeInstanceOf(InvalidBusinessHoursSetException);
      expect(repo.replaceAll).not.toHaveBeenCalled();
    });

    it('rejects endTime <= startTime for a day that is not closed', async () => {
      const days = fullWeek();
      days[1] = { ...days[1], startTime: '17:00', endTime: '09:00' };
      await expect(
        service.replaceBusinessHours('tenant-1', actor, days),
      ).rejects.toBeInstanceOf(InvalidBusinessHoursSetException);
      expect(repo.replaceAll).not.toHaveBeenCalled();
    });

    it('allows endTime <= startTime on a closed day', async () => {
      const days = fullWeek();
      days[1] = {
        ...days[1],
        isClosed: true,
        startTime: '00:00',
        endTime: '00:00',
      };
      repo.replaceAll.mockResolvedValue(toEntities(days));

      await expect(
        service.replaceBusinessHours('tenant-1', actor, days),
      ).resolves.toHaveLength(7);
    });

    it('replaces all 7 days and records an audit entry', async () => {
      const days = fullWeek();
      repo.replaceAll.mockResolvedValue(toEntities(days));

      await service.replaceBusinessHours('tenant-1', actor, days);

      expect(repo.replaceAll).toHaveBeenCalledWith('tenant-1', days);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SALON_BUSINESS_HOURS_UPDATED' }),
      );
    });
  });
});
