import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { ServiceCategoryEntity } from '../../../src/modules/services/domain/entities/service-category.entity';
import { ServiceCategoryRepositoryPort } from '../../../src/modules/services/domain/ports/service-category-repository.port';
import { ServiceCategoryService } from '../../../src/modules/services/application/service-category.service';
import { NoUpdateFieldsProvidedException } from '../../../src/modules/services/application/exceptions/service.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

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

describe('ServiceCategoryService', () => {
  let repo: jest.Mocked<ServiceCategoryRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: ServiceCategoryService;

  beforeEach(() => {
    repo = {
      findAllForTenant: jest.fn(),
      findByIdForTenant: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new ServiceCategoryService(
      repo,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('createCategory', () => {
    it('creates a category and records an audit entry', async () => {
      repo.create.mockResolvedValue(makeCategory());

      const result = await service.createCategory('tenant-1', actor, {
        name: 'Hair',
      });

      expect(result.id).toBe('category-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_CATEGORY_CREATED' }),
      );
    });
  });

  describe('updateCategory', () => {
    it('rejects an update with no fields provided', async () => {
      await expect(
        service.updateCategory('tenant-1', 'category-1', actor, {}),
      ).rejects.toBeInstanceOf(NoUpdateFieldsProvidedException);
      expect(repo.findByIdForTenant).not.toHaveBeenCalled();
    });

    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant category', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.updateCategory('tenant-1', 'ghost', actor, { name: 'Nails' }),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
    });

    it('updates and records an audit entry', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeCategory());
      repo.update.mockResolvedValue(makeCategory({ name: 'Nails' }));

      const result = await service.updateCategory(
        'tenant-1',
        'category-1',
        actor,
        { name: 'Nails' },
      );

      expect(result.name).toBe('Nails');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_CATEGORY_UPDATED' }),
      );
    });
  });

  describe('deleteCategory', () => {
    it('soft-deletes and records an audit entry', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeCategory());

      await service.deleteCategory('tenant-1', 'category-1', actor);

      expect(repo.softDelete).toHaveBeenCalledWith('tenant-1', 'category-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_CATEGORY_DELETED' }),
      );
    });

    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant category', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.deleteCategory('tenant-1', 'ghost', actor),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
