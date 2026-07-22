import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'rbac:permission';

/**
 * Marks a route as requiring a specific named permission (docs/adr/
 * ADR-005-rbac.md, SYSTEM_ARCHITECTURE.md Section 7.4), e.g.
 * `@RequirePermission('billing:manage')`. Enforced by `PermissionGuard`,
 * which resolves the caller's effective permission set (union across all
 * held roles) via `PermissionResolverService`.
 */
export const RequirePermission = (permissionKey: string) =>
  SetMetadata(PERMISSION_KEY, permissionKey);
