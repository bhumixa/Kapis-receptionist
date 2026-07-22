import { SetMetadata } from '@nestjs/common';
import { RoleName } from '@prisma/client';

export const ROLES_KEY = 'rbac:roles';

/**
 * Marks a route as requiring at least the given role (docs/adr/
 * ADR-005-rbac.md). Convention: pass exactly one role — the *minimum*
 * rank required, e.g. `@Roles(RoleName.MANAGER)`. A user holding that role
 * **or** any higher-ranked role (`OWNER`, `SUPER_ADMIN`) satisfies it,
 * per `common/constants/rbac.constants.ts`'s `ROLE_RANK`/
 * `satisfiesRoleRequirement`. Enforced by `RolesGuard`.
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
