import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { SalonApiService } from '../../../../core/api/salon-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import { Holiday } from '../../../../shared/models/holiday.model';

/** `/app/salon/holidays` (docs/SALON_ARCHITECTURE.md) — list + inline add/edit/delete, no modal needed for this small a form. */
@Component({
  selector: 'app-holidays-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './holidays-page.html',
})
export class HolidaysPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly salonApi = inject(SalonApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageSalon = this.permissionService.can('salon:manage');

  readonly holidays = signal<Holiday[]>([]);
  readonly isLoading = signal(true);
  readonly listError = signal<string | null>(null);

  readonly isCreating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = this.formBuilder.nonNullable.group({
    date: ['', Validators.required],
    reason: ['', Validators.required],
  });

  readonly editingId = signal<string | null>(null);
  readonly isSavingEdit = signal(false);
  readonly editError = signal<string | null>(null);
  readonly editForm = this.formBuilder.nonNullable.group({
    date: ['', Validators.required],
    reason: ['', Validators.required],
  });

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.salonApi.listHolidays().subscribe({
      next: (holidays) => {
        this.holidays.set(holidays);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  createHoliday(): void {
    if (this.createForm.invalid || this.isCreating()) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.isCreating.set(true);
    this.createError.set(null);

    this.salonApi.createHoliday(this.createForm.getRawValue()).subscribe({
      next: (holiday) => {
        this.isCreating.set(false);
        this.holidays.update((current) =>
          [...current, holiday].sort((a, b) => a.date.localeCompare(b.date)),
        );
        this.createForm.reset({ date: '', reason: '' });
      },
      error: (error: unknown) => {
        this.isCreating.set(false);
        this.createError.set(
          error instanceof ApiError && error.code === 'DUPLICATE_HOLIDAY_DATE'
            ? 'A holiday already exists on that date.'
            : 'Could not create the holiday.',
        );
      },
    });
  }

  startEdit(holiday: Holiday): void {
    this.editingId.set(holiday.id);
    this.editError.set(null);
    this.editForm.setValue({ date: holiday.date, reason: holiday.reason });
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(holiday: Holiday): void {
    if (this.editForm.invalid || this.isSavingEdit()) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.isSavingEdit.set(true);
    this.editError.set(null);

    this.salonApi.updateHoliday(holiday.id, this.editForm.getRawValue()).subscribe({
      next: (updated) => {
        this.isSavingEdit.set(false);
        this.holidays.update((current) =>
          current
            .map((h) => (h.id === updated.id ? updated : h))
            .sort((a, b) => a.date.localeCompare(b.date)),
        );
        this.editingId.set(null);
      },
      error: (error: unknown) => {
        this.isSavingEdit.set(false);
        this.editError.set(
          error instanceof ApiError && error.code === 'DUPLICATE_HOLIDAY_DATE'
            ? 'A holiday already exists on that date.'
            : 'Could not save changes.',
        );
      },
    });
  }

  deleteHoliday(holiday: Holiday): void {
    if (!confirm(`Delete the holiday on ${holiday.date} (${holiday.reason})?`)) {
      return;
    }
    this.salonApi.deleteHoliday(holiday.id).subscribe({
      next: () => {
        this.holidays.update((current) => current.filter((h) => h.id !== holiday.id));
      },
    });
  }
}
