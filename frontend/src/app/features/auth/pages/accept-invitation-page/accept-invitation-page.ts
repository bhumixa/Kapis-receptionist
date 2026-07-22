import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { AuthApiService } from '../../../../core/auth/auth-api.service';
import { AuthStateService } from '../../../../core/auth/auth-state.service';
import { passwordStrengthValidator } from '../../../../shared/validators/password-strength.validator';

/**
 * `/auth/accept-invitation/:token` (docs/FRONTEND_ARCHITECTURE.md Section
 * 3.2's previously-reserved route, closed out this milestone alongside
 * `POST /auth/accept-invitation`). Unlike verify-email's no-form page, this
 * one collects the invitee's name and password, then logs them straight in
 * on success (matching `AuthApiService.login`'s response shape) — no
 * separate "now go log in" step.
 */
@Component({
  selector: 'app-accept-invitation-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accept-invitation-page.html',
})
export class AcceptInvitationPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authApi = inject(AuthApiService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly tokenInvalid = signal(!this.token);

  readonly form = this.formBuilder.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, passwordStrengthValidator()]],
  });

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.authApi.acceptInvitation({ token: this.token, ...this.form.getRawValue() }).subscribe({
      next: ({ user, tenant, accessToken }) => {
        this.authState.setSession(user, tenant, accessToken);
        void this.router.navigateByUrl('/app/dashboard');
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        if (error instanceof ApiError && error.code === 'INVALID_OR_EXPIRED_INVITATION') {
          this.tokenInvalid.set(true);
          return;
        }
        this.errorMessage.set(
          error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
        );
      },
    });
  }
}
