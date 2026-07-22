import { Injectable, computed, signal } from '@angular/core';
import { Tenant } from '../../shared/models/tenant.model';
import { User } from '../../shared/models/user.model';

/**
 * The single source of truth for client-side session state
 * (docs/FRONTEND_ARCHITECTURE.md Section 5.6). `accessToken` is held in
 * memory only — never `localStorage` — to limit exposure to XSS-based
 * theft (SYSTEM_ARCHITECTURE.md Section 7.1/9.9); the refresh token never
 * touches this service at all, since it lives solely in the httpOnly
 * cookie the browser manages.
 */
@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly _currentUser = signal<User | null>(null);
  private readonly _currentTenant = signal<Tenant | null>(null);
  private readonly _accessToken = signal<string | null>(null);
  /**
   * Milestone 3 (docs/adr/ADR-006): the tenant a `SUPER_ADMIN` has chosen to
   * "act as" from the Admin console — client-side UI state only, never
   * persisted server-side and reset on logout/refresh. `tenantImpersonationInterceptor`
   * reads this to attach `X-Impersonate-Tenant-Id`; it has no effect at all
   * for a non-`SUPER_ADMIN` session (the backend ignores the header
   * entirely for those callers regardless of what this holds).
   */
  private readonly _impersonatedTenant = signal<Tenant | null>(null);

  readonly currentUser = this._currentUser.asReadonly();
  readonly currentTenant = this._currentTenant.asReadonly();
  readonly accessToken = this._accessToken.asReadonly();
  readonly isAuthenticated = computed(() => this._accessToken() !== null);
  readonly impersonatedTenant = this._impersonatedTenant.asReadonly();
  readonly isImpersonating = computed(() => this._impersonatedTenant() !== null);

  setSession(user: User, tenant: Tenant | null, accessToken: string): void {
    this._currentUser.set(user);
    this._currentTenant.set(tenant);
    this._accessToken.set(accessToken);
  }

  /** Used after a silent `/auth/refresh` — session identity is unchanged, only the token rotates. */
  updateAccessToken(accessToken: string): void {
    this._accessToken.set(accessToken);
  }

  /** Called by the Admin Tenants page's "Act as" control; `null` clears it ("Return to my account"). */
  setImpersonatedTenant(tenant: Tenant | null): void {
    this._impersonatedTenant.set(tenant);
  }

  clear(): void {
    this._currentUser.set(null);
    this._currentTenant.set(null);
    this._accessToken.set(null);
    this._impersonatedTenant.set(null);
  }
}
