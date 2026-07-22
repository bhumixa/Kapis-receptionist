import { ExecutionContext } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { InvalidTenantContextException } from '../../../src/core/guards/rbac.exceptions';
import { TenantScopedGuard } from '../../../src/core/guards/tenant-scoped.guard';
import { AccessTokenPayload } from '../../../src/modules/auth/application/token.service';

function makeContext(user: AccessTokenPayload): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('TenantScopedGuard', () => {
  const guard = new TenantScopedGuard();

  it('allows SUPER_ADMIN unconditionally, even with a null tenantId', () => {
    const context = makeContext({
      sub: 'admin-1',
      email: 'admin@platform.com',
      tenantId: null,
      roles: [RoleName.SUPER_ADMIN],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a non-SUPER_ADMIN user with a resolvable tenantId', () => {
    const context = makeContext({
      sub: 'user-1',
      email: 'owner@salon.com',
      tenantId: 'tenant-1',
      roles: [RoleName.OWNER],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws for a non-SUPER_ADMIN user with a null tenantId', () => {
    const context = makeContext({
      sub: 'user-1',
      email: 'orphan@salon.com',
      tenantId: null,
      roles: [RoleName.STAFF],
    });
    expect(() => guard.canActivate(context)).toThrow(
      InvalidTenantContextException,
    );
  });
});
