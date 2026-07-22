import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthStateService } from '../auth/auth-state.service';
import { SessionService } from '../auth/session.service';

/**
 * docs/FRONTEND_ARCHITECTURE.md Section 5.7 / 10.6: attaches the in-memory
 * access token to every outgoing request, and on a `401` transparently
 * attempts exactly one silent refresh (coordinated by `SessionService` so
 * concurrent 401s share one refresh call), retries the original request
 * with the new token, and — only on refresh failure — clears the session
 * and redirects to login with the originally-intended URL preserved.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authState = inject(AuthStateService);
  const sessionService = inject(SessionService);
  const router = inject(Router);

  const token = authState.accessToken();
  const authorizedReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authorizedReq).pipe(
    catchError((error: unknown) => {
      const isAuthEndpoint = req.url.includes('/auth/refresh') || req.url.includes('/auth/login');

      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthEndpoint) {
        return sessionService.refreshAccessToken().pipe(
          switchMap((newToken) =>
            next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } })),
          ),
          catchError((refreshError: unknown) => {
            authState.clear();
            void router.navigate(['/auth/login'], {
              queryParams: { returnUrl: router.url },
            });
            return throwError(() => refreshError);
          }),
        );
      }

      return throwError(() => error);
    }),
  );
};
