import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { AuthApiService } from '../../../../core/auth/auth-api.service';

/**
 * docs/FRONTEND_ARCHITECTURE.md Section 5.3 — always shows the same
 * success message regardless of whether the email exists, mirroring the
 * backend's own enumeration-resistant design (docs/API_SPECIFICATION.md
 * Section 4). The frontend must never "helpfully" branch this message.
 */
@Component({
  selector: 'app-forgot-password-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './forgot-password-page.html',
})
export class ForgotPasswordPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authApi = inject(AuthApiService);

  readonly isSubmitting = signal(false);
  readonly submitted = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.authApi.forgotPassword(this.form.getRawValue().email).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.submitted.set(true);
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(
          error instanceof ApiError && error.code === 'RATE_LIMITED'
            ? 'Too many attempts. Please wait a moment and try again.'
            : 'Something went wrong. Please try again.',
        );
      },
    });
  }
}
