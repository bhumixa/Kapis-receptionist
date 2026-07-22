import { RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantContextService } from '../../../src/core/context/tenant-context.service';
import {
  InvalidTenantContextException,
  TenantResourceNotFoundException,
} from '../../../src/core/guards/rbac.exceptions';
import { PrismaService } from '../../../src/database/prisma.service';
import { AccessTokenPayload } from '../../../src/modules/auth/application/token.service';
import type { AuthenticatedRequest } from '../../../src/modules/auth/interface/types/authenticated-request.interface';

function makeRequest(
  user: AccessTokenPayload,
  impersonateTenantIdHeader?: string,
): AuthenticatedRequest {
  return {
    user,
    impersonateTenantIdHeader,
    method: 'GET',
    originalUrl: '/api/v1/tenant',
    ip: '127.0.0.1',
  } as unknown as AuthenticatedRequest;
}

describe('TenantContextService', () => {
  let prisma: { tenant: { findFirst: jest.Mock } };
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

  beforeEach(() => {
    prisma = { tenant: { findFirst: jest.fn() } };
    auditLog = { record: jest.fn() };
  });

  function makeService(
    user: AccessTokenPayload,
    impersonateTenantIdHeader?: string,
  ): TenantContextService {
    return new TenantContextService(
      makeRequest(user, impersonateTenantIdHeader),
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  }

  it("returns the JWT's own tenantId for a non-SUPER_ADMIN caller", async () => {
    const service = makeService({
      sub: 'user-1',
      email: 'owner@salon.com',
      tenantId: 'tenant-1',
      roles: [RoleName.OWNER],
    });
    await expect(service.getTenantId()).resolves.toBe('tenant-1');
    expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
  });

  it('ignores the impersonation header entirely for a non-SUPER_ADMIN caller (spoofing protection)', async () => {
    const service = makeService(
      {
        sub: 'user-1',
        email: 'owner@salon.com',
        tenantId: 'tenant-1',
        roles: [RoleName.OWNER],
      },
      'tenant-2',
    );
    await expect(service.getTenantId()).resolves.toBe('tenant-1');
    expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('returns null for SUPER_ADMIN with no impersonation header', async () => {
    const service = makeService({
      sub: 'admin-1',
      email: 'admin@platform.com',
      tenantId: null,
      roles: [RoleName.SUPER_ADMIN],
    });
    await expect(service.getTenantId()).resolves.toBeNull();
  });

  it('requireTenantId() throws InvalidTenantContextException for SUPER_ADMIN with no impersonation header', async () => {
    const service = makeService({
      sub: 'admin-1',
      email: 'admin@platform.com',
      tenantId: null,
      roles: [RoleName.SUPER_ADMIN],
    });
    await expect(service.requireTenantId()).rejects.toBeInstanceOf(
      InvalidTenantContextException,
    );
  });

  it('resolves and audit-logs a valid impersonation target for SUPER_ADMIN', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-2' } as any);
    const service = makeService(
      {
        sub: 'admin-1',
        email: 'admin@platform.com',
        tenantId: null,
        roles: [RoleName.SUPER_ADMIN],
      },
      'tenant-2',
    );

    await expect(service.getTenantId()).resolves.toBe('tenant-2');
    expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
      where: { id: 'tenant-2', deletedAt: null },
      select: { id: true },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SUPER_ADMIN_TENANT_SWITCH',
        entityId: 'tenant-2',
        tenantId: 'tenant-2',
        actorId: 'admin-1',
      }),
    );
  });

  it('throws TenantResourceNotFoundException when the impersonated tenant does not exist', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);
    const service = makeService(
      {
        sub: 'admin-1',
        email: 'admin@platform.com',
        tenantId: null,
        roles: [RoleName.SUPER_ADMIN],
      },
      'ghost-tenant',
    );

    await expect(service.getTenantId()).rejects.toBeInstanceOf(
      TenantResourceNotFoundException,
    );
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('memoizes resolution: calling getTenantId() twice only hits the database/audit log once', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-2' } as any);
    const service = makeService(
      {
        sub: 'admin-1',
        email: 'admin@platform.com',
        tenantId: null,
        roles: [RoleName.SUPER_ADMIN],
      },
      'tenant-2',
    );

    await service.getTenantId();
    await service.getTenantId();

    expect(prisma.tenant.findFirst).toHaveBeenCalledTimes(1);
    expect(auditLog.record).toHaveBeenCalledTimes(1);
  });
});
