import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { AppointmentsApiService } from '../../../../core/api/appointments-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import {
  APPOINTMENT_STATUS_LABELS,
  Appointment,
} from '../../../../shared/models/appointment.model';

/** `/app/appointments/:id` (API_SPECIFICATION.md Section 10) — detail, cancel, and a simple reschedule form. */
@Component({
  selector: 'app-appointment-detail-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './appointment-detail-page.html',
})
export class AppointmentDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly appointmentsApi = inject(AppointmentsApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canDelete = this.permissionService.can('appointments:manage');
  readonly statusLabels = APPOINTMENT_STATUS_LABELS;

  readonly appointment = signal<Appointment | null>(null);
  readonly isLoading = signal(true);
  readonly actionError = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);

  readonly isRescheduling = signal(false);
  readonly rescheduleForm = this.formBuilder.nonNullable.group({
    date: ['', Validators.required],
    time: ['', Validators.required],
  });

  private readonly id = this.route.snapshot.paramMap.get('id')!;

  constructor() {
    this.load();
  }

  formatDateTime(iso: string): string {
    return iso.slice(0, 16).replace('T', ' ');
  }

  private load(): void {
    this.isLoading.set(true);
    this.appointmentsApi.getAppointment(this.id).subscribe({
      next: (appointment) => {
        this.appointment.set(appointment);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  get isCancellable(): boolean {
    const status = this.appointment()?.status;
    return status === 'PENDING' || status === 'CONFIRMED';
  }

  cancel(): void {
    if (!confirm('Cancel this appointment?')) {
      return;
    }
    this.actionError.set(null);
    this.appointmentsApi.cancelAppointment(this.id).subscribe({
      next: (result) => {
        this.appointment.set(result);
        this.warnings.set(result.warnings);
      },
      error: (error: unknown) => {
        this.actionError.set(
          error instanceof ApiError ? error.message : 'Could not cancel the appointment.',
        );
      },
    });
  }

  startReschedule(): void {
    this.isRescheduling.set(true);
  }

  submitReschedule(): void {
    if (this.rescheduleForm.invalid) {
      this.rescheduleForm.markAllAsTouched();
      return;
    }
    const raw = this.rescheduleForm.getRawValue();
    const newStartTime = new Date(`${raw.date}T${raw.time}:00.000Z`).toISOString();

    this.actionError.set(null);
    this.appointmentsApi.rescheduleAppointment(this.id, { newStartTime }).subscribe({
      next: (result) => {
        this.warnings.set(result.warnings);
        void this.router.navigate(['/app/appointments', result.newAppointment.id]);
      },
      error: (error: unknown) => {
        this.actionError.set(
          error instanceof ApiError ? error.message : 'Could not reschedule the appointment.',
        );
      },
    });
  }

  remove(): void {
    if (!confirm('Permanently remove this appointment record? This cannot be undone.')) {
      return;
    }
    this.appointmentsApi.deleteAppointment(this.id).subscribe({
      next: () => void this.router.navigate(['/app/appointments']),
    });
  }
}
