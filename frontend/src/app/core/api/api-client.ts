import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, map, retry } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-error';
import { ApiErrorEnvelope, ApiSuccessEnvelope } from './api-response';

export interface ApiRequestOptions {
  params?: HttpParams | Record<string, string | number | boolean>;
  /** Milestone 6: lets `AppointmentsApiService` attach `Idempotency-Key` on booking-critical writes (API_SPECIFICATION.md Section 2.13). */
  headers?: Record<string, string>;
}

/**
 * Every call carries credentials (SYSTEM_ARCHITECTURE.md Section 7.2): the
 * httpOnly refresh-token cookie only round-trips to the backend when the
 * browser is told to send/accept credentials on a cross-origin request.
 * Harmless on requests that don't need it — the cookie is scoped to
 * `/api/v1/auth` server-side regardless (auth.constants.ts,
 * `REFRESH_TOKEN_COOKIE_PATH`).
 */
const WITH_CREDENTIALS = { withCredentials: true } as const;

/**
 * The single low-level HTTP wrapper every domain API service is built on
 * (docs/FRONTEND_ARCHITECTURE.md Section 10.2). Owns base-URL resolution,
 * envelope unwrapping, and typed-error conversion, so domain services never
 * touch `.data` or a raw `HttpErrorResponse` themselves.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .get<ApiSuccessEnvelope<T>>(this.url(path), {
        params: options?.params,
        ...WITH_CREDENTIALS,
      })
      .pipe(
        // Section 10.4: a single retry, network-level failures only —
        // never on a real 4xx/5xx HTTP response.
        retry({
          count: 1,
          delay: (error: unknown) => {
            if (error instanceof HttpErrorResponse && error.status === 0) {
              return timer(500);
            }
            return throwError(() => error);
          },
        }),
        map((envelope) => envelope.data),
        catchError((error: unknown) => this.handleError(error)),
      );
  }

  post<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .post<ApiSuccessEnvelope<T>>(this.url(path), body, {
        params: options?.params,
        headers: options?.headers,
        ...WITH_CREDENTIALS,
      })
      .pipe(
        map((envelope) => envelope.data),
        catchError((error: unknown) => this.handleError(error)),
      );
  }

  patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .patch<ApiSuccessEnvelope<T>>(this.url(path), body, {
        params: options?.params,
        ...WITH_CREDENTIALS,
      })
      .pipe(
        map((envelope) => envelope.data),
        catchError((error: unknown) => this.handleError(error)),
      );
  }

  put<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .put<ApiSuccessEnvelope<T>>(this.url(path), body, {
        params: options?.params,
        ...WITH_CREDENTIALS,
      })
      .pipe(
        map((envelope) => envelope.data),
        catchError((error: unknown) => this.handleError(error)),
      );
  }

  delete<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .delete<ApiSuccessEnvelope<T>>(this.url(path), {
        params: options?.params,
        ...WITH_CREDENTIALS,
      })
      .pipe(
        map((envelope) => envelope.data),
        catchError((error: unknown) => this.handleError(error)),
      );
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private handleError(error: unknown): Observable<never> {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as Partial<ApiErrorEnvelope> | null;
      return throwError(
        () =>
          new ApiError(
            body?.error?.code ?? 'INTERNAL_ERROR',
            body?.error?.message ?? error.message,
            body?.error?.details ?? [],
            body?.requestId ?? null,
            error.status,
          ),
      );
    }
    return throwError(
      () =>
        new ApiError('INTERNAL_ERROR', 'An unexpected client-side error occurred.', [], null, 0),
    );
  }
}
