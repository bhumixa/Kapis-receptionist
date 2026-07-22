import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { InvalidTenantContextException } from '../guards/rbac.exceptions';

export interface CurrentTenantOptions {
  /** Throws `InvalidTenantContextException` instead of returning `null` (e.g. for endpoints a SUPER_ADMIN, whose token has no fixed tenant, must never reach). */
  required?: boolean;
}

/**
 * Reads the caller's `tenantId` from the JWT claims `JwtAuthGuard` attached
 * to the request — only valid behind that guard. Mirrors `@CurrentUser()`'s
 * existing style (direct `request.user` read) rather than routing through
 * `TenantContextService`; both derive from the same `AccessTokenPayload.tenantId`
 * claim, so there's no divergence risk (docs/adr/ADR-005-rbac.md).
 *
 * `tenantId` is honestly typed as nullable — it is `null` for `SUPER_ADMIN`.
 * Use `@CurrentTenant({ required: true })` for a non-nullable return.
 */
export const CurrentTenant = createParamDecorator(
  (data: CurrentTenantOptions = {}, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = request.user.tenantId;
    if (data.required && tenantId === null) {
      throw new InvalidTenantContextException();
    }
    return tenantId;
  },
);
