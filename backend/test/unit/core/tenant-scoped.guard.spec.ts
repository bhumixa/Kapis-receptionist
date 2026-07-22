import { InvalidTenantContextException } from '../../../src/core/guards/rbac.exceptions';
import { TenantContextService } from '../../../src/core/context/tenant-context.service';
import { TenantScopedGuard } from '../../../src/core/guards/tenant-scoped.guard';

/**
 * Milestone 3 (docs/adr/ADR-006): `TenantScopedGuard` now delegates entirely
 * to `TenantContextService.requireTenantId()` — its own behavior (SUPER_ADMIN
 * bypass, impersonation, spoofing protection) is unit-tested directly against
 * `TenantContextService` (see `tenant-context.service.spec.ts`); this guard's
 * own test only needs to prove it calls through correctly and propagates
 * `InvalidTenantContextException`.
 */
describe('TenantScopedGuard', () => {
  function makeGuard(
    tenantContext: Pick<TenantContextService, 'requireTenantId'>,
  ): TenantScopedGuard {
    return new TenantScopedGuard(tenantContext as TenantContextService);
  }

  it('passes when TenantContextService resolves a tenant', async () => {
    const guard = makeGuard({
      requireTenantId: jest.fn().mockResolvedValue('tenant-1'),
    });
    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it('propagates InvalidTenantContextException when no tenant resolves', async () => {
    const guard = makeGuard({
      requireTenantId: jest
        .fn()
        .mockRejectedValue(new InvalidTenantContextException()),
    });
    await expect(guard.canActivate()).rejects.toBeInstanceOf(
      InvalidTenantContextException,
    );
  });
});
