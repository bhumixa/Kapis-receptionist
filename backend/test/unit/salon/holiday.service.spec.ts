import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { HolidayEntity } from '../../../src/modules/salon/domain/entities/holiday.entity';
import { HolidayRepositoryPort } from '../../../src/modules/salon/domain/ports/holiday-repository.port';
import { HolidayService } from '../../../src/modules/salon/application/holiday.service';
import {
  DuplicateHolidayDateException,
  NoUpdateFieldsProvidedException,
} from '../../../src/modules/salon/application/exceptions/salon.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeHoliday(overrides: Partial<HolidayEntity> = {}): HolidayEntity {
  return {
    id: 'holiday-1',
    tenantId: 'tenant-1',
    date: '2026-12-25',
    reason: 'Christmas Day',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('HolidayService', () => {
  let repo: jest.Mocked<HolidayRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: HolidayService;

  beforeEach(() => {
    repo = {
      findAllForTenant: jest.fn(),
      findByIdForTenant: jest.fn(),
      findByDateForTenant: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new HolidayService(repo, auditLog as unknown as AuditLogService);
  });

  describe('createHoliday', () => {
    it('creates a holiday and records an audit entry', async () => {
      repo.findByDateForTenant.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeHoliday());

      const result = await service.createHoliday('tenant-1', actor, {
        date: '2026-12-25',
        reason: 'Christmas Day',
      });

      expect(result.id).toBe('holiday-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SALON_HOLIDAY_CREATED' }),
      );
    });

    it('rejects a duplicate date', async () => {
      repo.findByDateForTenant.mockResolvedValue(makeHoliday());

      await expect(
        service.createHoliday('tenant-1', actor, {
          date: '2026-12-25',
          reason: 'Christmas Day',
        }),
      ).rejects.toBeInstanceOf(DuplicateHolidayDateException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateHoliday', () => {
    it('rejects an update with no fields provided', async () => {
      await expect(
        service.updateHoliday('tenant-1', 'holiday-1', actor, {}),
      ).rejects.toBeInstanceOf(NoUpdateFieldsProvidedException);
      expect(repo.findByIdForTenant).not.toHaveBeenCalled();
    });

    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant holiday', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.updateHoliday('tenant-1', 'ghost', actor, { reason: 'x' }),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
    });

    it('rejects changing the date to one that collides with another holiday', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeHoliday());
      repo.findByDateForTenant.mockResolvedValue(
        makeHoliday({ id: 'other-holiday', date: '2026-12-26' }),
      );

      await expect(
        service.updateHoliday('tenant-1', 'holiday-1', actor, {
          date: '2026-12-26',
        }),
      ).rejects.toBeInstanceOf(DuplicateHolidayDateException);
    });

    it('allows keeping the same date while changing only the reason', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeHoliday());
      repo.update.mockResolvedValue(makeHoliday({ reason: 'Updated' }));

      const result = await service.updateHoliday(
        'tenant-1',
        'holiday-1',
        actor,
        { date: '2026-12-25', reason: 'Updated' },
      );

      expect(repo.findByDateForTenant).not.toHaveBeenCalled();
      expect(result.reason).toBe('Updated');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SALON_HOLIDAY_UPDATED' }),
      );
    });
  });

  describe('deleteHoliday', () => {
    it('deletes and records an audit entry', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeHoliday());

      await service.deleteHoliday('tenant-1', 'holiday-1', actor);

      expect(repo.delete).toHaveBeenCalledWith('tenant-1', 'holiday-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SALON_HOLIDAY_DELETED' }),
      );
    });

    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant holiday', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.deleteHoliday('tenant-1', 'ghost', actor),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});
