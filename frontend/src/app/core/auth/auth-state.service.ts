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

  readonly currentUser = this._currentUser.asReadonly();
  readonly currentTenant = this._currentTenant.asReadonly();
  readonly accessToken = this._accessToken.asReadonly();
  readonly isAuthenticated = computed(() => this._accessToken() !== null);

  setSession(user: User, tenant: Tenant | null, accessToken: string): void {
    this._currentUser.set(user);
    this._currentTenant.set(tenant);
    this._accessToken.set(accessToken);
  }

  /** Used after a silent `/auth/refresh` — session identity is unchanged, only the token rotates. */
  updateAccessToken(accessToken: string): void {
    this._accessToken.set(accessToken);
  }

  clear(): void {
    this._currentUser.set(null);
    this._currentTenant.set(null);
    this._accessToken.set(null);
  }
}
