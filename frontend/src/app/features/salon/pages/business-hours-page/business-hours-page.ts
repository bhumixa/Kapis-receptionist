import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { SalonApiService } from '../../../../core/api/salon-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import { DAY_OF_WEEK_LABELS } from '../../../../shared/models/business-hours.model';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `/app/salon/business-hours` (docs/SALON_ARCHITECTURE.md) — the weekly hours editor, always all 7 days. */
@Component({
  selector: 'app-business-hours-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './business-hours-page.html',
})
export class BusinessHoursPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly salonApi = inject(SalonApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageSalon = this.permissionService.can('salon:manage');
  readonly dayLabels = DAY_OF_WEEK_LABELS;

  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);

  // Wrapped in an outer FormGroup (rather than a bare FormArray) so the
  // template's <form> can bind [formGroup] and let ngSubmit's built-in
  // preventDefault take effect — a bare FormArray has no directive to bind
  // to the <form> element itself, which silently degrades ngSubmit into a
  // real HTML form submission (full page reload) instead of an Angular event.
  readonly form = this.formBuilder.group({
    days: this.formBuilder.array(
      Array.from({ length: 7 }, (_, dayOfWeek) => this.buildDayGroup(dayOfWeek)),
    ),
  });

  get days() {
    return this.form.controls.days;
  }

  private buildDayGroup(dayOfWeek: number) {
    return this.formBuilder.nonNullable.group({
      dayOfWeek: [dayOfWeek],
      startTime: ['09:00', [Validators.pattern(HH_MM_PATTERN)]],
      endTime: ['17:00', [Validators.pattern(HH_MM_PATTERN)]],
      isClosed: [true],
    });
  }

  get dayGroups() {
    return this.days.controls as ReturnType<typeof this.buildDayGroup>[];
  }

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.salonApi.getBusinessHours().subscribe({
      next: (result) => {
        for (const day of result) {
          this.days.at(day.dayOfWeek).patchValue({
            startTime: day.isClosed ? '09:00' : day.startTime,
            endTime: day.isClosed ? '17:00' : day.endTime,
            isClosed: day.isClosed,
          });
        }
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  save(): void {
    if (this.isSaving()) {
      return;
    }
    this.error.set(null);
    this.saved.set(false);

    const openDayInvalid = this.dayGroups.some(
      (group) =>
        !group.controls.isClosed.value &&
        group.controls.endTime.value <= group.controls.startTime.value,
    );
    if (openDayInvalid) {
      this.error.set('Closing time must be after opening time for every open day.');
      return;
    }

    this.isSaving.set(true);
    this.salonApi.updateBusinessHours(this.days.getRawValue()).subscribe({
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
