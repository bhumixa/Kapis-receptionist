import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AccessTokenPayload } from '../../modules/auth/application/token.service';
import type { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { InvalidTenantContextException } from '../guards/rbac.exceptions';

/**
 * Request-scoped tenant/user context (SYSTEM_ARCHITECTURE.md Section 8.3),
 * resolving `tenantId`/current user from the authenticated request once per
 * request rather than threading them manually through function parameters.
 *
 * No consumer exists yet this sprint (docs/adr/ADR-005-rbac.md) — no
 * tenant-owned business module/base-repository pattern is in scope here.
 * Built ahead of its first real user, the same precedent as `TokenService`
 * being built ahead of `RolesGuard`. Note: Nest request-scoped providers
 * cascade DI scope to whatever injects them — a non-issue today with zero
 * consumers, worth remembering once one exists.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(
    @Inject(REQUEST) private readonly request: AuthenticatedRequest,
  ) {}

  getTenantId(): string | null {
    return this.request.user.tenantId;
  }

  requireTenantId(): string {
    const tenantId = this.request.user.tenantId;
    if (!tenantId) {
      throw new InvalidTenantContextException();
    }
    return tenantId;
  }

  getCurrentUser(): AccessTokenPayload {
    return this.request.user;
  }
}
