import { RoleName, TenantStatus } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { PrismaService } from '../../../src/database/prisma.service';
import { TenantService } from '../../../src/modules/tenants/application/tenant.service';
import { TenantEntity } from '../../../src/modules/tenants/domain/entities/tenant.entity';
import { SalonProfileEntity } from '../../../src/modules/salon/domain/entities/salon-profile.entity';
import { SalonProfileRepositoryPort } from '../../../src/modules/salon/domain/ports/salon-profile-repository.port';
import { SalonProfileService } from '../../../src/modules/salon/application/salon-profile.service';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
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

function makeProfile(
  overrides: Partial<SalonProfileEntity> = {},
): SalonProfileEntity {
  return {
    id: 'profile-1',
    tenantId: 'tenant-1',
    description: null,
    contactEmail: null,
    contactPhone: null,
    website: null,
    currency: 'USD',
    logoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('SalonProfileService', () => {
  let profiles: jest.Mocked<SalonProfileRepositoryPort>;
  let tenantService: jest.Mocked<
    Pick<TenantService, 'getProfile' | 'updateProfile'>
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let prisma: { $transaction: jest.Mock };
  let service: SalonProfileService;

  beforeEach(() => {
    profiles = {
      findByTenantId: jest.fn(),
      createDefault: jest.fn(),
      upsert: jest.fn(),
    };
    tenantService = {
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
    };
    service = new SalonProfileService(
      profiles,
      tenantService as unknown as TenantService,
      auditLog as unknown as AuditLogService,
      prisma as unknown as PrismaService,
    );
  });

  describe('getProfile', () => {
    it('composes Tenant fields with an existing SalonProfile row', async () => {
      tenantService.getProfile.mockResolvedValue(makeTenant());
      profiles.findByTenantId.mockResolvedValue(
        makeProfile({ currency: 'BRL' }),
      );

      const result = await service.getProfile('tenant-1');

      expect(result.name).toBe('Bella Salon');
      expect(result.currency).toBe('BRL');
      expect(profiles.createDefault).not.toHaveBeenCalled();
    });

    it('auto-vivifies a default SalonProfile row when none exists yet (mirrors TenantSettingsService)', async () => {
      tenantService.getProfile.mockResolvedValue(makeTenant());
      profiles.findByTenantId.mockResolvedValue(null);
      profiles.createDefault.mockResolvedValue(makeProfile());

      await service.getProfile('tenant-1');

      expect(profiles.createDefault).toHaveBeenCalledWith('tenant-1');
    });
  });

  describe('updateProfile', () => {
    it('splits input, writes Tenant and SalonProfile fields inside one transaction, and records one audit entry', async () => {
      tenantService.getProfile.mockResolvedValue(
        makeTenant({ name: 'Updated Salon' }),
      );
      tenantService.updateProfile.mockResolvedValue(
        makeTenant({ name: 'Updated Salon' }),
      );
      profiles.findByTenantId.mockResolvedValue(makeProfile());
      profiles.upsert.mockResolvedValue(makeProfile({ currency: 'EUR' }));

      const result = await service.updateProfile('tenant-1', actor, {
        name: 'Updated Salon',
        currency: 'EUR',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tenantService.updateProfile).toHaveBeenCalledWith(
        'tenant-1',
        actor,
        { name: 'Updated Salon' },
        expect.anything(),
      );
      expect(profiles.upsert).toHaveBeenCalledWith(
        'tenant-1',
        { currency: 'EUR' },
        expect.anything(),
      );
      expect(auditLog.record).toHaveBeenCalledTimes(1);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SALON_PROFILE_UPDATED',
          metadata: { fields: ['name', 'currency'] },
        }),
      );
      expect(result.name).toBe('Updated Salon');
    });

    it('only calls TenantService when only Tenant-owned fields change', async () => {
      tenantService.getProfile.mockResolvedValue(makeTenant());
      tenantService.updateProfile.mockResolvedValue(makeTenant());
      profiles.findByTenantId.mockResolvedValue(makeProfile());

      await service.updateProfile('tenant-1', actor, {
        timezone: 'America/Sao_Paulo',
      });

      expect(tenantService.updateProfile).toHaveBeenCalled();
      expect(profiles.upsert).not.toHaveBeenCalled();
    });

    it('only touches SalonProfile when only SalonProfile-owned fields change', async () => {
      tenantService.getProfile.mockResolvedValue(makeTenant());
      profiles.findByTenantId.mockResolvedValue(makeProfile());
      profiles.upsert.mockResolvedValue(
        makeProfile({ contactEmail: 'hi@bellasalon.com' }),
      );

      await service.updateProfile('tenant-1', actor, {
        contactEmail: 'hi@bellasalon.com',
      });

      expect(tenantService.updateProfile).not.toHaveBeenCalled();
      expect(profiles.upsert).toHaveBeenCalled();
    });

    it('is a no-op (no writes, no audit) when given an empty input', async () => {
      tenantService.getProfile.mockResolvedValue(makeTenant());
      profiles.findByTenantId.mockResolvedValue(makeProfile());

      await service.updateProfile('tenant-1', actor, {});

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tenantService.updateProfile).not.toHaveBeenCalled();
      expect(profiles.upsert).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});
