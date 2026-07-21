import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { requestIdInterceptor } from './core/interceptors/request-id.interceptor';
// AuthInterceptor (Milestone 2), IdempotencyKeyInterceptor (Milestone 5), and
// LoadingInterceptor (once UiStateService exists) join this array in the
// documented order (docs/FRONTEND_ARCHITECTURE.md Section 10.6) as each
// milestone that needs them lands.
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([requestIdInterceptor])),
  ],
};
