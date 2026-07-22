import { RoleName } from '../models/user.model';

/**
 * Mirrors `backend/prisma/seed.ts`'s `ROLE_PERMISSIONS` matrix (docs/adr/
 * ADR-005-rbac.md). A deliberate, documented duplication — no shared types
 * package exists between frontend/backend, and `PermissionService` is a
 * UX-convenience layer only (FRONTEND_ARCHITECTURE.md Section 5.9); the
 * backend's `PermissionGuard`/`PermissionResolverService` remain the sole
 * security boundary regardless of what this map says.
 *
 * Keep this in lockstep with `backend/prisma/seed.ts` whenever a permission
 * key or a role's permission set changes — an accepted maintenance cost,
 * not an oversight.
 */
export const ROLE_PERMISSIONS: Record<RoleName, readonly string[]> = {
  SUPER_ADMIN: [
    'billing:manage',
    'account:delete',
    'staff:invite',
    'tenant:manage',
    'settings:manage',
    'salon:manage',
    'employees:manage',
    'services:manage',
  ],
  OWNER: [
    'billing:manage',
    'account:delete',
    'staff:invite',
    'tenant:manage',
    'settings:manage',
    'salon:manage',
    'employees:manage',
    'services:manage',
  ],
  MANAGER: [
    'staff:invite',
    'tenant:manage',
    'settings:manage',
    'salon:manage',
    'employees:manage',
    'services:manage',
  ],
  STAFF: [],
};
