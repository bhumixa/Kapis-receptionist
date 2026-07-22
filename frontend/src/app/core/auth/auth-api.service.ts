import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Tenant } from '../../shared/models/tenant.model';
import { User } from '../../shared/models/user.model';

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantName: string;
  timezone: string;
}

export interface RegisterResponse {
  user: User;
  tenant: Tenant;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  tenant: Tenant | null;
  accessToken: string;
  expiresIn: number;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface MeResponse {
  user: User;
  tenant: Tenant | null;
}

export interface VerifyEmailResponse {
  user: User;
  message: string;
}

export interface MessageResponse {
  message: string;
}

/**
 * Thin, typed wrapper over `POST/GET /auth/*` (docs/API_SPECIFICATION.md
 * Section 4) — HTTP calls and request/response typing only, no state, no
 * business logic (FRONTEND_ARCHITECTURE.md Section 10.2/10.8). The refresh
 * token itself never appears here: it lives only in the httpOnly cookie the
 * browser manages automatically (ApiClient sends `withCredentials: true`).
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly api = inject(ApiClient);

  register(request: RegisterRequest): Observable<RegisterResponse> {
    return this.api.post<RegisterResponse>('/auth/register', request);
  }

  login(request: LoginRequest): Observable<LoginResponse> {
    return this.api.post<LoginResponse>('/auth/login', request);
  }

  logout(): Observable<{ message: string }> {
    return this.api.post<{ message: string }>('/auth/logout', {});
  }

  refresh(): Observable<RefreshResponse> {
    return this.api.post<RefreshResponse>('/auth/refresh', {});
  }

  me(): Observable<MeResponse> {
    return this.api.get<MeResponse>('/auth/me');
  }

  verifyEmail(token: string): Observable<VerifyEmailResponse> {
    return this.api.post<VerifyEmailResponse>('/auth/verify-email', { token });
  }

  resendVerification(email: string): Observable<MessageResponse> {
    return this.api.post<MessageResponse>('/auth/resend-verification', {
      email,
    });
  }

  forgotPassword(email: string): Observable<MessageResponse> {
    return this.api.post<MessageResponse>('/auth/forgot-password', { email });
  }

  resetPassword(token: string, newPassword: string): Observable<MessageResponse> {
    return this.api.post<MessageResponse>('/auth/reset-password', {
      token,
      newPassword,
    });
  }
}
