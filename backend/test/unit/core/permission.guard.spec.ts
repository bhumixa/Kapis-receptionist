import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '@prisma/client';
import { InsufficientPermissionException } from '../../../src/core/guards/rbac.exceptions';
import { PermissionGuard } from '../../../src/core/guards/permission.guard';
import { SuperAdminBypassService } from '../../../src/core/guards/super-admin-bypass.service';
import { PermissionResolverService } from '../../../src/core/permission-resolver.service';
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
  requiredPermission: string | undefined,
  { bypassResult = false, hasPermission = false } = {},
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredPermission),
  };
  const bypass = { checkAndLog: jest.fn().mockReturnValue(bypassResult) };
  const permissionResolver = {
    hasPermission: jest.fn().mockResolvedValue(hasPermission),
  };
  const guard = new PermissionGuard(
    reflector as unknown as Reflector,
    bypass as unknown as SuperAdminBypassService,
    permissionResolver as unknown as PermissionResolverService,
  );
  return { guard, reflector, bypass, permissionResolver };
}

describe('PermissionGuard', () => {
  it('allows access when no @RequirePermission() metadata is present', async () => {
    const { guard } = buildGuard(undefined);
    await expect(guard.canActivate(makeContext(makeUser()))).resolves.toBe(
      true,
    );
  });

  it('allows access when the resolver confirms the permission', async () => {
    const { guard, permissionResolver } = buildGuard('staff:invite', {
      hasPermission: true,
    });
    const user = makeUser({ roles: [RoleName.MANAGER] });

    await expect(guard.canActivate(makeContext(user))).resolves.toBe(true);
    expect(permissionResolver.hasPermission).toHaveBeenCalledWith(
      [RoleName.MANAGER],
      'staff:invite',
    );
  });

  it('denies access when the resolver denies the permission', async () => {
    const { guard } = buildGuard('billing:manage', { hasPermission: false });
    const context = makeContext(makeUser({ roles: [RoleName.STAFF] }));

    await expect(guard.canActivate(context)).rejects.toThrow(
      InsufficientPermissionException,
    );
  });

  it('bypasses the resolver entirely when SuperAdminBypassService grants a bypass', async () => {
    const { guard, bypass, permissionResolver } = buildGuard('billing:manage', {
      bypassResult: true,
    });
    const user = makeUser({ roles: [RoleName.SUPER_ADMIN] });
    const context = makeContext(user);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(bypass.checkAndLog).toHaveBeenCalledWith(user, context, {
      type: 'permission',
      requiredPermission: 'billing:manage',
    });
    expect(permissionResolver.hasPermission).not.toHaveBeenCalled();
  });
});
