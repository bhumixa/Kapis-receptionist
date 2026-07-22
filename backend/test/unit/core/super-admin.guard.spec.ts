import { ExecutionContext } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { InsufficientRoleException } from '../../../src/core/guards/rbac.exceptions';
import { SuperAdminGuard } from '../../../src/core/guards/super-admin.guard';
import { AccessTokenPayload } from '../../../src/modules/auth/application/token.service';

function makeContext(user: AccessTokenPayload): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  it('allows a SUPER_ADMIN user', () => {
    const context = makeContext({
      sub: 'admin-1',
      email: 'admin@platform.com',
      tenantId: null,
      roles: [RoleName.SUPER_ADMIN],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies an OWNER user', () => {
    const context = makeContext({
      sub: 'user-1',
      email: 'owner@salon.com',
      tenantId: 'tenant-1',
      roles: [RoleName.OWNER],
    });
    expect(() => guard.canActivate(context)).toThrow(InsufficientRoleException);
  });
});
