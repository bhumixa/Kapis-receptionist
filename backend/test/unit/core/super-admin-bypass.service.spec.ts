import { ExecutionContext } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { SuperAdminBypassService } from '../../../src/core/guards/super-admin-bypass.service';
import { AccessTokenPayload } from '../../../src/modules/auth/application/token.service';
import { SecurityEventService } from '../../../src/modules/auth/application/security-event.service';

function makeUser(
  overrides: Partial<AccessTokenPayload> = {},
): AccessTokenPayload {
  return {
    sub: 'user-1',
    email: 'owner@salon.com',
    tenantId: 'tenant-1',
    roles: [RoleName.OWNER],
    ...overrides,
  };
}

function makeContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl: '/api/v1/internal/rbac-probe/roles/manager-plus',
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('SuperAdminBypassService', () => {
  it('returns false and does not log for a non-SUPER_ADMIN user', () => {
    const securityEvents = { record: jest.fn() };
    const service = new SuperAdminBypassService(
      securityEvents as unknown as SecurityEventService,
    );

    const result = service.checkAndLog(
      makeUser({ roles: [RoleName.MANAGER] }),
      makeContext(),
      { type: 'role', requiredRoles: [RoleName.MANAGER] },
    );

    expect(result).toBe(false);
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('returns true and logs SUPER_ADMIN_BYPASS for a SUPER_ADMIN user', () => {
    const securityEvents = { record: jest.fn() };
    const service = new SuperAdminBypassService(
      securityEvents as unknown as SecurityEventService,
    );
    const user = makeUser({
      sub: 'admin-1',
      tenantId: null,
      roles: [RoleName.SUPER_ADMIN],
    });

    const result = service.checkAndLog(user, makeContext(), {
      type: 'role',
      requiredRoles: [RoleName.MANAGER],
    });

    expect(result).toBe(true);
    expect(securityEvents.record).toHaveBeenCalledWith('SUPER_ADMIN_BYPASS', {
      userId: 'admin-1',
      tenantId: null,
      route: 'GET /api/v1/internal/rbac-probe/roles/manager-plus',
      type: 'role',
      requiredRoles: [RoleName.MANAGER],
    });
  });
});
