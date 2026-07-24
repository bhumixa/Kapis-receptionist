import { Prisma, RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import { CustomerEntity } from '../../../src/modules/customers/domain/entities/customer.entity';
import { CustomerRepositoryPort } from '../../../src/modules/customers/domain/ports/customer-repository.port';
import { CustomerService } from '../../../src/modules/customers/application/customer.service';
import {
  NoUpdateFieldsProvidedException,
  PhoneNumberAlreadyExistsException,
} from '../../../src/modules/customers/application/exceptions/customer.exceptions';

const actor = {
  sub: 'user-1',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeCustomer(overrides: Partial<CustomerEntity> = {}): CustomerEntity {
  return {
    id: 'customer-1',
    tenantId: 'tenant-1',
    phoneNumber: '+5511999999999',
    firstName: 'Sofia',
    lastName: 'Reyes',
    email: null,
    preferredLanguage: null,
    marketingOptIn: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('CustomerService', () => {
  let repo: jest.Mocked<CustomerRepositoryPort>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: CustomerService;

  beforeEach(() => {
    repo = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      findByIdsForTenant: jest.fn(),
      findByPhoneForTenant: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    auditLog = { record: jest.fn() };
    service = new CustomerService(repo, auditLog as unknown as AuditLogService);
  });

  describe('createCustomer', () => {
    it('creates a customer and records an audit entry', async () => {
      repo.findByPhoneForTenant.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeCustomer());

      const result = await service.createCustomer('tenant-1', actor, {
        phoneNumber: '+5511999999999',
      });

      expect(result.id).toBe('customer-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_CREATED' }),
      );
    });

    it('rejects a duplicate phone number with the existing customerId in details', async () => {
      repo.findByPhoneForTenant.mockResolvedValue(
        makeCustomer({ id: 'existing-1' }),
      );

      await expect(
        service.createCustomer('tenant-1', actor, {
          phoneNumber: '+5511999999999',
        }),
      ).rejects.toBeInstanceOf(PhoneNumberAlreadyExistsException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateCustomer', () => {
    it('rejects an update with no fields provided', async () => {
      await expect(
        service.updateCustomer('tenant-1', 'customer-1', actor, {}),
      ).rejects.toBeInstanceOf(NoUpdateFieldsProvidedException);
      expect(repo.findByIdForTenant).not.toHaveBeenCalled();
    });

    it('throws TenantResourceNotFoundException for a nonexistent/cross-tenant customer', async () => {
      repo.findByIdForTenant.mockResolvedValue(null);

      await expect(
        service.updateCustomer('tenant-1', 'ghost', actor, { firstName: 'x' }),
      ).rejects.toBeInstanceOf(TenantResourceNotFoundException);
    });
  });

  describe('deleteCustomer', () => {
    it('soft-deletes and records an audit entry', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeCustomer());

      await service.deleteCustomer('tenant-1', 'customer-1', actor);

      expect(repo.softDelete).toHaveBeenCalledWith('tenant-1', 'customer-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_DELETED' }),
      );
    });
  });

  describe('findOrCreateByPhoneForTenant', () => {
    it('returns the existing customer when the phone number is already known', async () => {
      const existing = makeCustomer();
      repo.findByPhoneForTenant.mockResolvedValue(existing);

      const result = await service.findOrCreateByPhoneForTenant(
        'tenant-1',
        '+5511999999999',
        'Some WhatsApp Name',
      );

      expect(result).toEqual(existing);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates a new customer using the WhatsApp profile name as a firstName fallback', async () => {
      repo.findByPhoneForTenant.mockResolvedValue(null);
      const created = makeCustomer({ firstName: 'Maria' });
      repo.create.mockResolvedValue(created);

      const result = await service.findOrCreateByPhoneForTenant(
        'tenant-1',
        '+5511999999999',
        'Maria',
      );

      expect(result).toEqual(created);
      expect(repo.create).toHaveBeenCalledWith('tenant-1', {
        phoneNumber: '+5511999999999',
        firstName: 'Maria',
      });
    });

    it('creates a new customer with a null firstName when no WhatsApp profile name is given', async () => {
      repo.findByPhoneForTenant.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeCustomer({ firstName: null }));

      await service.findOrCreateByPhoneForTenant('tenant-1', '+5511999999999');

      expect(repo.create).toHaveBeenCalledWith('tenant-1', {
        phoneNumber: '+5511999999999',
        firstName: null,
      });
    });

    it('resolves to the winner of a concurrent create race instead of throwing', async () => {
      repo.findByPhoneForTenant
        .mockResolvedValueOnce(null) // first check: not found
        .mockResolvedValueOnce(makeCustomer()); // re-check after conflict: found
      repo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.findOrCreateByPhoneForTenant(
        'tenant-1',
        '+5511999999999',
      );

      expect(result).toEqual(makeCustomer());
    });
  });
});
