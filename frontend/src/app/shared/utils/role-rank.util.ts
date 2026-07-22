import { RoleName } from '../models/user.model';

/**
 * Mirrors `backend/src/common/constants/rbac.constants.ts`'s `ROLE_RANK`
 * (docs/adr/ADR-005-rbac.md) — no shared types package exists between
 * frontend/backend, so this is a deliberate, documented duplication. Keep
 * in lockstep with the backend file whenever a role's rank changes (it
 * shouldn't, roles are fixed) or a new role is added.
 *
 * Used only by the authorization-guard layer (`roleGuard`) to decide
 * whether a user's roles satisfy a route's minimum required role — it does
 * not change anything about the permission model itself.
 */
export const ROLE_RANK: Record<RoleName, number> = {
  SUPER_ADMIN: 100,
  OWNER: 30,
  MANAGER: 20,
  STAFF: 10,
};

/**
 * True when the highest-ranked role in `userRoles` meets or exceeds the
 * lowest-ranked role in `requiredRoles`. Route metadata is documented to
 * declare exactly one required role (the minimum) — e.g.
 * `data: { roles: ['MANAGER'] }` — but this also supports multiple for
 * completeness (any one satisfying is enough).
 */
export function satisfiesRoleRequirement(
  userRoles: RoleName[],
  requiredRoles: RoleName[],
): boolean {
  if (requiredRoles.length === 0) {
    return true;
  }
  const maxUserRank = Math.max(0, ...userRoles.map((role) => ROLE_RANK[role]));
  const minRequiredRank = Math.min(...requiredRoles.map((role) => ROLE_RANK[role]));
  return maxUserRank >= minRequiredRank;
}
