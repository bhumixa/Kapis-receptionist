import { Injectable, Signal, computed, inject } from '@angular/core';
import { ROLE_PERMISSIONS } from '../../shared/constants/role-permissions.constant';
import { AuthStateService } from './auth-state.service';

/**
 * UX-convenience permission check (docs/FRONTEND_ARCHITECTURE.md Section
 * 5.9, docs/adr/ADR-005-rbac.md) — reads exclusively from `AuthStateService`
 * signals, no API call of its own. Never a security boundary: the backend's
 * `PermissionGuard` is authoritative regardless of what this reports.
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly authState = inject(AuthStateService);

  can(permission: string): Signal<boolean> {
    return computed(() => {
      const user = this.authState.currentUser();
      if (!user) {
        return false;
      }
      return user.roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
    });
  }
}
