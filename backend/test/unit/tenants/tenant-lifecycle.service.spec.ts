import { RoleName, TenantStatus } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { TenantEntity } from '../../../src/modules/tenants/domain/entities/tenant.entity';
import { TenantRepositoryPort } from '../../../src/modules/tenants/domain/ports/tenant-repository.port';
import { InvalidTenantLifecycleTransitionException } from '../../../src/modules/tenants/application/exceptions/tenant.exceptions';
import { TenantLifecycleService } from '../../../src/modules/tenants/application/tenant-lifecycle.service';

const actor = {
  sub: 'admin-1',
  email: 'admin@platform.com',
  tenantId: null,
  roles: [RoleName.SUPER_ADMIN],
};

function makeTenant(overrides: Partial<TenantEntity> = {}): TenantEntity {
  return {
    id: 'tenant-1',
    name: 'Bella Salon',
    slug: 'bella-salon',
    status: TenantStatus.ACTIVE,
    timezone: 'UTC',
    addressLine1: null,
    addressLine2: null,
    city: null,
    countryCode: null,
    defaultLocale: 'en',
    trialEndsAt: null,
    suspendedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('TenantLifecycleService', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: TenantLifecycleService;

  beforeEach(() => {
    tenants = {
      findById: jest.fn(),
      updateProfile: jest.fn(),
      updateStatus: jest.fn(),
      findManyForAdmin: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new TenantLifecycleService(
      tenants,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('suspend', () => {
    it('suspends an ACTIVE tenant and records an audit event', async () => {
      tenants.findById.mockResolvedValue(
        makeTenant({ status: TenantStatus.ACTIVE }),
      );
      tenants.updateStatus.mockResolvedValue(
        makeTenant({ status: TenantStatus.SUSPENDED }),
      );

      const result = await service.suspend('tenant-1', actor, 'abuse report');

      expect(result.status).toBe(TenantStatus.SUSPENDED);
      const [, , extra] = tenants.updateStatus.mock.calls[0];
      expect(tenants.updateStatus).toHaveBeenCalledWith(
        'tenant-1',
        TenantStatus.SUSPENDED,
        expect.anything(),
      );
      expect(extra?.suspendedAt).toBeInstanceOf(Date);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_SUSPENDED' }),
      );
    });

    it('is idempotent for an already-SUSPENDED tenant', async () => {
      const suspended = makeTenant({ status: TenantStatus.SUSPENDED });
      tenants.findById.mockResolvedValue(suspended);

      const result = await service.suspend('tenant-1', actor);

      expect(result).toBe(suspended);
      expect(tenants.updateStatus).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('rejects suspending a CANCELLED tenant', async () => {
      tenants.findById.mockResolvedValue(
        makeTenant({ status: TenantStatus.CANCELLED }),
      );

      await expect(service.suspend('tenant-1', actor)).rejects.toBeInstanceOf(
        InvalidTenantLifecycleTransitionException,
      );
    });

    it('throws TenantResourceNotFoundException for a nonexistent tenant', async () => {
      tenants.findById.mockResolvedValue(null);
      await expect(service.suspend('ghost', actor)).rejects.toBeInstanceOf(
        TenantResourceNotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('reactivates a SUSPENDED tenant to ACTIVE and records an audit event', async () => {
      tenants.findById.mockResolvedValue(
        makeTenant({ status: TenantStatus.SUSPENDED }),
      );
      tenants.updateStatus.mockResolvedValue(
        makeTenant({ status: TenantStatus.ACTIVE }),
      );

      const result = await service.reactivate('tenant-1', actor);

      expect(result.status).toBe(TenantStatus.ACTIVE);
      expect(tenants.updateStatus).toHaveBeenCalledWith(
        'tenant-1',
        TenantStatus.ACTIVE,
        { suspendedAt: null },
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_REACTIVATED' }),
      );
    });

    it.each([
      TenantStatus.TRIAL,
      TenantStatus.ACTIVE,
      TenantStatus.PAST_DUE,
      TenantStatus.CANCELLED,
    ])('rejects reactivating a tenant currently %s', async (status) => {
      tenants.findById.mockResolvedValue(makeTenant({ status }));
      await expect(
        service.reactivate('tenant-1', actor),
      ).rejects.toBeInstanceOf(InvalidTenantLifecycleTransitionException);
    });
  });
});
