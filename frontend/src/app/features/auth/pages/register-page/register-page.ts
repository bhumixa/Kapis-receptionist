import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { AuthApiService } from '../../../../core/auth/auth-api.service';
import { matchFieldValidator } from '../../../../shared/validators/match-field.validator';
import { passwordStrengthValidator } from '../../../../shared/validators/password-strength.validator';

/**
 * docs/FRONTEND_ARCHITECTURE.md Section 5.2, adapted to this sprint's
 * actual register contract (docs/adr/ADR-003-core-authentication.md):
 * register does not establish a session (no `/app/onboarding` to redirect
 * into yet — that's Milestone 3), so success routes to `/auth/login` with
 * a confirmation banner instead.
 */
@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register-page.html',
})
export class RegisterPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authApi = inject(AuthApiService);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, passwordStrengthValidator()]],
      confirmPassword: ['', [Validators.required]],
      firstName: ['', [Validators.required, Validators.maxLength(100)]],
      lastName: ['', [Validators.required, Validators.maxLength(100)]],
      tenantName: ['', [Validators.required, Validators.maxLength(100)]],
      // Auto-detected, presented as an editable default — never silently
      // assumed (FRONTEND_ARCHITECTURE.md Section 5.2).
      timezone: [Intl.DateTimeFormat().resolvedOptions().timeZone, [Validators.required]],
    },
    { validators: [matchFieldValidator('password', 'confirmPassword')] },
  );

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    const { email, password, firstName, lastName, tenantName, timezone } = this.form.getRawValue();

    this.authApi
      .register({ email, password, firstName, lastName, tenantName, timezone })
      .subscribe({
        next: () => {
          void this.router.navigate(['/auth/login'], {
            queryParams: { registered: 'true' },
          });
        },
        error: (error: unknown) => {
          this.isSubmitting.set(false);
          this.errorMessage.set(this.messageFor(error));
        },
      });
  }

  private messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.code === 'EMAIL_ALREADY_EXISTS') {
        this.form.controls.email.setErrors({ taken: true });
        return 'An account with this email already exists.';
      }
      if (error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
        return error.details
          .map((detail) => (detail as { field: string; issue: string }).issue)
          .join(' ');
      }
      if (error.code === 'RATE_LIMITED') {
        return 'Too many attempts. Please wait a moment and try again.';
      }
      return error.message;
    }
    return 'Something went wrong. Please try again.';
  }
}
