import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { AuthStateService } from './auth-state.service';

/**
 * Session lifecycle orchestration: the app-bootstrap silent refresh
 * (docs/FRONTEND_ARCHITECTURE.md Section 5.6) and the single-in-flight
 * refresh coordination `AuthInterceptor` needs on a 401 (Section 5.7) live
 * here, not in `AuthStateService` (a plain signal store) or
 * `AuthApiService` (a plain HTTP wrapper) — keeping each of the three
 * classes to one responsibility.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly authApi = inject(AuthApiService);
  private readonly authState = inject(AuthStateService);

  private refreshInFlight$: Observable<string> | null = null;

  /**
   * Called once on app bootstrap, before any protected route renders — a
   * still-valid refresh cookie re-establishes the session with no visible
   * login flash; a missing/expired one just leaves the app logged out.
   */
  bootstrap(): Observable<boolean> {
    return this.refreshAccessToken().pipe(
      switchMap((accessToken) =>
        this.authApi.me().pipe(
          tap(({ user, tenant }) => this.authState.setSession(user, tenant, accessToken)),
          map(() => true),
        ),
      ),
      catchError(() => {
        this.authState.clear();
        return of(false);
      }),
    );
  }

  /**
   * Exchanges the httpOnly refresh cookie for a new access token, rotating
   * it server-side. Concurrent callers (e.g. several requests 401-ing at
   * once) share the same in-flight call rather than each triggering their
   * own refresh — the exact refresh-storm prevention FRONTEND_ARCHITECTURE.md
   * Section 5.7 specifies for `AuthInterceptor`.
   */
  refreshAccessToken(): Observable<string> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }

    this.refreshInFlight$ = this.authApi.refresh().pipe(
      map((response) => response.accessToken),
      tap((accessToken) => this.authState.updateAccessToken(accessToken)),
      finalize(() => {
        this.refreshInFlight$ = null;
      }),
      shareReplay(1),
    );

    return this.refreshInFlight$;
  }

  logout(): Observable<void> {
    return this.authApi.logout().pipe(
      map(() => undefined),
      finalize(() => this.authState.clear()),
    );
  }
}
