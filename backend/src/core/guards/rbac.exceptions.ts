import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { RBAC_ERROR_CODES } from '../../common/constants/rbac.constants';
import { ERROR_CODES } from '../../common/constants/error-codes.constant';

/**
 * Typed, named business-rule exceptions (same convention as `modules/auth/
 * application/exceptions/auth.exceptions.ts`) — the global exception filter
 * maps these to API_SPECIFICATION.md Section 2.3's envelope automatically
 * via their structured body, without any controller-level try/catch.
 */

export class InsufficientRoleException extends ForbiddenException {
  constructor(requiredRoles: RoleName[]) {
    super({
      code: RBAC_ERROR_CODES.INSUFFICIENT_ROLE,
      message: 'You do not have the required role to perform this action.',
      details: [{ requiredRoles }],
    });
  }
}

export class InsufficientPermissionException extends ForbiddenException {
  constructor(requiredPermission: string) {
    super({
      code: RBAC_ERROR_CODES.INSUFFICIENT_PERMISSION,
      message: 'You do not have permission to perform this action.',
      details: [{ requiredPermission }],
    });
  }
}

export class InvalidTenantContextException extends ForbiddenException {
  constructor() {
    super({
      code: RBAC_ERROR_CODES.INVALID_TENANT_CONTEXT,
      message: 'This action requires a resolvable tenant context.',
      details: [],
    });
  }
}

/**
 * Reserved for the future per-resource-ID `TenantScopedGuard` extension
 * (docs/adr/ADR-005-rbac.md) — not thrown anywhere yet this sprint. When a
 * tenant-owned resource lookup by `:id` finds a row belonging to a
 * different tenant, this should be thrown instead of a generic 404 so the
 * intent is explicit, while still resolving to the same `404 NOT_FOUND`
 * envelope (never `403`) per API_SPECIFICATION.md Section 2.3.1's
 * anti-enumeration rule.
 */
export class TenantResourceNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: RBAC_ERROR_CODES.TENANT_RESOURCE_NOT_FOUND,
      message: 'Resource not found.',
      details: [],
    });
  }
}

/**
 * `402 TENANT_SUSPENDED` (API_SPECIFICATION.md Section 2.3.1) — thrown by
 * `TenantActiveGuard` (Milestone 3) when a tenant-scoped mutating request
 * targets a `SUSPENDED`/`CANCELLED` tenant. A structural skeleton only: no
 * plan-limit logic here, that's Milestone 8. `SUPER_ADMIN` always bypasses
 * this guard (a support action against a suspended tenant is exactly the
 * scenario Super Admin access exists for), so this exception is never
 * thrown for a `SUPER_ADMIN` caller.
 */
export class TenantSuspendedException extends HttpException {
  constructor() {
    super(
      {
        code: ERROR_CODES.TENANT_SUSPENDED,
        message:
          'This tenant is suspended or cancelled and cannot perform this action.',
        details: [],
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
