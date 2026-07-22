import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { authInterceptor } from './core/interceptors/auth.interceptor';
import { requestIdInterceptor } from './core/interceptors/request-id.interceptor';
import { tenantImpersonationInterceptor } from './core/interceptors/tenant-impersonation.interceptor';
// IdempotencyKeyInterceptor (Milestone 5) and LoadingInterceptor (once
// UiStateService exists) join this array in the documented order
// (docs/FRONTEND_ARCHITECTURE.md Section 10.6) as each milestone needs them.
import { SessionService } from './core/auth/session.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([requestIdInterceptor, tenantImpersonationInterceptor, authInterceptor]),
    ),
    // Silent refresh before any protected route renders
    // (docs/FRONTEND_ARCHITECTURE.md Section 5.6) — a still-valid refresh
    // cookie re-establishes the session with no login flash; a
    // missing/expired one just leaves the app logged out, guards redirect
    // normally.
    provideAppInitializer(() => inject(SessionService).bootstrap()),
  ],
};
