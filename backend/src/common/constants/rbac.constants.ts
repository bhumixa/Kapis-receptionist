import { RoleName } from '@prisma/client';

/**
 * Redis cache key prefix for `PermissionResolverService` (docs/adr/
 * ADR-005-rbac.md). Keyed by the flat `RoleName` enum string, not a role's
 * UUID — simpler to inspect via `redis-cli`, and `RoleName` is fixed and
 * never renamed, so there's no id-lookup needed to invalidate by name.
 */
export const ROLE_PERMISSIONS_CACHE_KEY_PREFIX = 'rbac:role-permissions:';

/**
 * Fixed rank ordering used only by the authorization-guard layer to decide
 * whether a user's roles satisfy a route's minimum required role (docs/adr/
 * ADR-005-rbac.md "Role hierarchy"). This does **not** change the underlying
 * schema: `Role`/`Permission`/`RolePermission` stay a flat, direct mapping —
 * rank is guard-layer sugar on top of it, not a new data model.
 */
export const ROLE_RANK: Record<RoleName, number> = {
  [RoleName.SUPER_ADMIN]: 100,
  [RoleName.OWNER]: 30,
  [RoleName.MANAGER]: 20,
  [RoleName.STAFF]: 10,
};

/**
 * True when the highest-ranked role in `userRoles` meets or exceeds the
 * lowest-ranked role in `requiredRoles`. `@Roles()` is documented to be
 * called with exactly one role (the minimum required) — e.g. `@Roles('MANAGER')`
 * is satisfied by `MANAGER`, `OWNER`, or `SUPER_ADMIN` — but this also
 * supports multiple required roles for completeness (any one satisfying is enough).
 */
export function satisfiesRoleRequirement(
  userRoles: RoleName[],
  requiredRoles: RoleName[],
): boolean {
  if (requiredRoles.length === 0) {
    return true;
  }
  const maxUserRank = Math.max(0, ...userRoles.map((role) => ROLE_RANK[role]));
  const minRequiredRank = Math.min(
    ...requiredRoles.map((role) => ROLE_RANK[role]),
  );
  return maxUserRank >= minRequiredRank;
}

export const RBAC_ERROR_CODES = {
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
  INVALID_TENANT_CONTEXT: 'INVALID_TENANT_CONTEXT',
  TENANT_RESOURCE_NOT_FOUND: 'TENANT_RESOURCE_NOT_FOUND',
} as const;
