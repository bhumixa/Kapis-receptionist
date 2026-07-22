import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { ServiceEntity } from '../../../src/modules/services/domain/entities/service.entity';
import { ServiceCategoryEntity } from '../../../src/modules/services/domain/entities/service-category.entity';
import { ServiceCategoryRepositoryPort } from '../../../src/modules/services/domain/ports/service-category-repository.port';
import { ServiceRepositoryPort } from '../../../src/modules/services/domain/ports/service-repository.port';
import { ServiceService } from '../../../src/modules/services/application/service.service';
import {
  InvalidCategoryReferenceException,
  NoUpdateFieldsProvidedException,
} from '../../../src/modules/services/application/exceptions/service.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeService(overrides: Partial<ServiceEntity> = {}): ServiceEntity {
  return {
    id: 'service-1',
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
    ...overrides,
  };
}

function makeCategory(
  overrides: Partial<ServiceCategoryEntity> = {},
): ServiceCategoryEntity {
  return {
    id: 'category-1',
    tenantId: 'tenant-1',
    name: 'Hair',
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ServiceService', () => {
  let repo: jest.Mocked<ServiceRepositoryPort>;
  let categoryRepo: jest.Mocked<ServiceCategoryRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: ServiceService;

  beforeEach(() => {
    repo = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      findByIdsForTenant: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    categoryRepo = {
      findAllForTenant: jest.fn(),
      findByIdForTenant: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new ServiceService(
      repo,
      categoryRepo,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('createService', () => {
    it('creates a service with no category and records an audit entry', async () => {
      repo.create.mockResolvedValue(makeService());

      const result = await service.createService('tenant-1', actor, {
        name: 'Haircut',
        durationMinutes: 45,
        priceCents: 8000,
      });

      expect(result.id).toBe('service-1');
      expect(categoryRepo.findByIdForTenant).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_CREATED' }),
      );
    });

    it('validates categoryId belongs to the tenant', async () => {
      categoryRepo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.createService('tenant-1', actor, {
          name: 'Haircut',
          durationMinutes: 45,
          priceCents: 8000,
          categoryId: 'other-tenant-category',
        }),
      ).rejects.toBeInstanceOf(InvalidCategoryReferenceException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('accepts a valid categoryId', async () => {
      categoryRepo.findByIdForTenant.mockResolvedValue(makeCategory());
      repo.create.mockResolvedValue(makeService({ categoryId: 'category-1' }));

      const result = await service.createService('tenant-1', actor, {
        name: 'Haircut',
        durationMinutes: 45,
        priceCents: 8000,
        categoryId: 'category-1',
      });

      expect(result.categoryId).toBe('category-1');
    });
  });

  describe('updateService', () => {
    it('rejects an update with no fields provided', async () => {
      await expect(
        service.updateService('tenant-1', 'service-1', actor, {}),
      ).rejects.toBeInstanceOf(NoUpdateFieldsProvidedException);
      expect(repo.findByIdForTenant).not.toHaveBeenCalled();
    });

    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant service', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.updateService('tenant-1', 'ghost', actor, { name: 'x' }),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
    });

    it('never rewrites historical AppointmentService snapshots (updates only the catalog row itself)', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeService());
      repo.update.mockResolvedValue(makeService({ priceCents: 9000 }));

      const result = await service.updateService(
        'tenant-1',
        'service-1',
        actor,
        { priceCents: 9000 },
      );

      expect(repo.update).toHaveBeenCalledWith('tenant-1', 'service-1', {
        priceCents: 9000,
      });
      expect(result.priceCents).toBe(9000);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_UPDATED' }),
      );
    });
  });

  describe('deleteService', () => {
    it('soft-deletes and records an audit entry', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeService());

      await service.deleteService('tenant-1', 'service-1', actor);

      expect(repo.softDelete).toHaveBeenCalledWith('tenant-1', 'service-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_DELETED' }),
      );
    });
  });
});
