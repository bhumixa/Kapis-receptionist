import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '@prisma/client';
import { InsufficientRoleException } from '../../../src/core/guards/rbac.exceptions';
import { RolesGuard } from '../../../src/core/guards/roles.guard';
import { SuperAdminBypassService } from '../../../src/core/guards/super-admin-bypass.service';
import { AccessTokenPayload } from '../../../src/modules/auth/application/token.service';

function makeUser(
  overrides: Partial<AccessTokenPayload> = {},
): AccessTokenPayload {
  return {
    sub: 'user-1',
    email: 'user@salon.com',
    tenantId: 'tenant-1',
    roles: [RoleName.STAFF],
    ...overrides,
  };
}

function makeContext(user: AccessTokenPayload): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, method: 'GET', originalUrl: '/x' }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function buildGuard(
  requiredRoles: RoleName[] | undefined,
  bypassResult = false,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  };
  const bypass = { checkAndLog: jest.fn().mockReturnValue(bypassResult) };
  const guard = new RolesGuard(
    reflector as unknown as Reflector,
    bypass as unknown as SuperAdminBypassService,
  );
  return { guard, reflector, bypass };
}

describe('RolesGuard', () => {
  it('allows access when no @Roles() metadata is present', () => {
    const { guard } = buildGuard(undefined);
    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
  });

  it('allows access when no @Roles() metadata is present (empty array)', () => {
    const { guard } = buildGuard([]);
    expect(guard.canActivate(makeContext(makeUser()))).toBe(true);
  });

  it('allows access for an exact role match', () => {
    const { guard } = buildGuard([RoleName.MANAGER]);
    const context = makeContext(makeUser({ roles: [RoleName.MANAGER] }));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access for a higher-ranked role', () => {
    const { guard } = buildGuard([RoleName.MANAGER]);
    const context = makeContext(makeUser({ roles: [RoleName.OWNER] }));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies access for a lower-ranked role', () => {
    const { guard } = buildGuard([RoleName.MANAGER]);
    const context = makeContext(makeUser({ roles: [RoleName.STAFF] }));
    expect(() => guard.canActivate(context)).toThrow(InsufficientRoleException);
  });

  it('bypasses the rank check when SuperAdminBypassService grants a bypass', () => {
    const { guard, bypass } = buildGuard([RoleName.MANAGER], true);
    const user = makeUser({ roles: [RoleName.SUPER_ADMIN] });
    const context = makeContext(user);

    expect(guard.canActivate(context)).toBe(true);
    expect(bypass.checkAndLog).toHaveBeenCalledWith(user, context, {
      type: 'role',
      requiredRoles: [RoleName.MANAGER],
    });
  });
});
