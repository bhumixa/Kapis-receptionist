import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { SalonApiService } from '../../../../core/api/salon-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * `/app/salon` (docs/SALON_ARCHITECTURE.md) — salon business profile,
 * contact info, timezone/locale, currency, and branding. Mirrors
 * `SettingsPage`'s established pattern (plain component signals, no
 * signal store — this feature is small enough not to need one).
 */
@Component({
  selector: 'app-salon-profile-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './salon-profile-page.html',
})
export class SalonProfilePage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly salonApi = inject(SalonApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageSalon = this.permissionService.can('salon:manage');

  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    description: [''],
    contactEmail: ['', Validators.email],
    contactPhone: [''],
    website: [''],
    addressLine1: [''],
    addressLine2: [''],
    city: [''],
    countryCode: ['', Validators.pattern(/^[A-Z]{2}$/)],
    timezone: ['', Validators.required],
    defaultLocale: ['en'],
    currency: ['USD', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
    logoUrl: [''],
    primaryColor: ['', Validators.pattern(HEX_COLOR_PATTERN)],
    secondaryColor: ['', Validators.pattern(HEX_COLOR_PATTERN)],
  });

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.salonApi.getProfile().subscribe({
      next: (profile) => {
        this.form.patchValue({
          name: profile.name,
          description: profile.description ?? '',
          contactEmail: profile.contactEmail ?? '',
          contactPhone: profile.contactPhone ?? '',
          website: profile.website ?? '',
          addressLine1: profile.addressLine1 ?? '',
          addressLine2: profile.addressLine2 ?? '',
          city: profile.city ?? '',
          countryCode: profile.countryCode ?? '',
          timezone: profile.timezone,
          defaultLocale: profile.defaultLocale,
          currency: profile.currency,
          logoUrl: profile.logoUrl ?? '',
          primaryColor: profile.primaryColor ?? '',
          secondaryColor: profile.secondaryColor ?? '',
        });
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  save(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.isSaving.set(true);
    this.error.set(null);
    this.saved.set(false);

    const raw = this.form.getRawValue();
    // Blank optional fields are sent as `undefined` (omitted), not an empty
    // string — the backend DTOs validate format (email/url/hex) only when present.
    const request = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, value === '' ? undefined : value]),
    );

    this.salonApi.updateProfile(request).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.saved.set(true);
      },
      error: (error: unknown) => {
        this.isSaving.set(false);
        this.error.set(error instanceof ApiError ? error.message : 'Could not save.');
      },
    });
  }
}
