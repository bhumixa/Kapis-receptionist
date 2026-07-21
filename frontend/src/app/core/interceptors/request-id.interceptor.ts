import { HttpInterceptorFn } from '@angular/common/http';

/**
 * docs/FRONTEND_ARCHITECTURE.md Section 10.6, interceptor #2: attaches a
 * per-request correlation ID so a support engineer can match a frontend
 * action to backend logs via one ID visible in the network tab. The
 * backend (docs/API_SPECIFICATION.md Section 2.9) mints its own canonical
 * `req_<ULID>` when this one doesn't match that format, so a simple
 * `crypto.randomUUID()` here is sufficient — the backend's ID, echoed back
 * in `X-Request-Id`, remains the source of truth for log correlation.
 */
export const requestIdInterceptor: HttpInterceptorFn = (req, next) => {
  return next(
    req.clone({
      setHeaders: { 'X-Request-Id': crypto.randomUUID() },
    }),
  );
};
