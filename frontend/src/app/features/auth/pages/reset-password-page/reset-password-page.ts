import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { AuthApiService } from '../../../../core/auth/auth-api.service';
import { matchFieldValidator } from '../../../../shared/validators/match-field.validator';
import { passwordStrengthValidator } from '../../../../shared/validators/password-strength.validator';

/**
 * docs/FRONTEND_ARCHITECTURE.md Section 5.3 — reads `:token` from the
 * route, new-password + confirm-password fields; on `400
 * INVALID_OR_EXPIRED_TOKEN` shows a clear "this link has expired" state
 * with a direct link back to Forgot Password, not a generic form error.
 */
@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reset-password-page.html',
})
export class ResetPasswordPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authApi = inject(AuthApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly tokenExpired = signal(!this.token);

  readonly form = this.formBuilder.nonNullable.group(
    {
      newPassword: ['', [Validators.required, passwordStrengthValidator()]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: [matchFieldValidator('newPassword', 'confirmPassword')] },
  );

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.authApi.resetPassword(this.token, this.form.getRawValue().newPassword).subscribe({
      next: () => {
        void this.router.navigate(['/auth/login'], {
          queryParams: { reset: 'true' },
        });
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        if (error instanceof ApiError && error.code === 'INVALID_OR_EXPIRED_TOKEN') {
          this.tokenExpired.set(true);
          return;
        }
        this.errorMessage.set(
          error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
        );
      },
    });
  }
}
