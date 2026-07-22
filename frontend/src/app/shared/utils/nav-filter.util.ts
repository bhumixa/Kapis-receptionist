import { RoleName, User } from '../models/user.model';
import { satisfiesRoleRequirement } from './role-rank.util';

export interface NavItem {
  label: string;
  route: string;
  /** Minimum role required to see this item — same convention as `roleGuard`'s route `data.roles`. */
  roles?: RoleName[];
  /** Named permission required to see this item, checked via the caller-supplied `permissionCheck`. */
  permission?: string;
}

/**
 * Permission-aware navigation filtering (docs/adr/ADR-005-rbac.md). A pure
 * function rather than a component — no sidebar/nav UI exists yet to
 * consume it (the current `DashboardLayout` is a minimal header-only
 * shell), so this ships as the reusable filtering primitive ahead of that
 * future consumer.
 */
export function filterNavItemsByAccess(
  items: NavItem[],
  user: User | null,
  permissionCheck: (permission: string) => boolean,
): NavItem[] {
  if (!user) {
    return [];
  }
  return items.filter((item) => {
    if (item.roles && !satisfiesRoleRequirement(user.roles, item.roles)) {
      return false;
    }
    if (item.permission && !permissionCheck(item.permission)) {
      return false;
    }
    return true;
  });
}
