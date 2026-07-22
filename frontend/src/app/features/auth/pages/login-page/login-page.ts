import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { AuthApiService } from '../../../../core/auth/auth-api.service';
import { AuthStateService } from '../../../../core/auth/auth-state.service';

/**
 * docs/FRONTEND_ARCHITECTURE.md Section 5.1. On `401 INVALID_CREDENTIALS`:
 * a single generic inline error — deliberately not distinguishing "wrong
 * email" from "wrong password", mirroring the backend's own
 * enumeration-resistant design.
 */
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login-page.html',
})
export class LoginPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authApi = inject(AuthApiService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly justRegistered = this.route.snapshot.queryParamMap.get('registered') === 'true';
  readonly justReset = this.route.snapshot.queryParamMap.get('reset') === 'true';
  readonly showResendVerification = signal(false);
  readonly resendSent = signal(false);

  readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.showResendVerification.set(false);
    this.resendSent.set(false);

    this.authApi.login(this.form.getRawValue()).subscribe({
      next: ({ user, tenant, accessToken }) => {
        this.authState.setSession(user, tenant, accessToken);
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(returnUrl ?? '/app/dashboard');
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
          this.showResendVerification.set(true);
        }
        this.errorMessage.set(this.messageFor(error));
      },
    });
  }

  resendVerification(): void {
    const email = this.form.controls.email.value;
    if (!email) {
      return;
    }
    this.authApi.resendVerification(email).subscribe({
      next: () => this.resendSent.set(true),
      // Enumeration-safe endpoint always succeeds; a network/5xx failure
      // here isn't worth a distinct error state for this secondary action.
      error: () => this.resendSent.set(true),
    });
  }

  private messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.code === 'INVALID_CREDENTIALS') {
        return 'Incorrect email or password.';
      }
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        return 'Please verify your email address before logging in.';
      }
      if (error.code === 'RATE_LIMITED') {
        return 'Too many attempts. Please wait a moment and try again.';
      }
      return error.message;
    }
    return 'Something went wrong. Please try again.';
  }
}
