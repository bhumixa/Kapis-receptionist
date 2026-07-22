import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiError } from '../../../../core/api/api-error';
import { EmployeesApiService } from '../../../../core/api/employees-api.service';
import { ServicesApiService } from '../../../../core/api/services-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import {
  EMPLOYEE_STATUS_LABELS,
  Employee,
  EmployeeStatus,
} from '../../../../shared/models/employee.model';
import { EmployeeTimeOff } from '../../../../shared/models/employee-time-off.model';
import { Service } from '../../../../shared/models/service.model';
import {
  DAY_OF_WEEK_LABELS,
  WorkingHoursEntry,
} from '../../../../shared/models/working-hours.model';

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * `/app/employees/:id` (docs/WORKFORCE_ARCHITECTURE.md) — employee profile,
 * status, working-hours editor, time-off management, and service
 * assignment, all on one page (following `SalonProfilePage`'s flattened
 * signals pattern, no signal store — ADR-008 precedent).
 */
@Component({
  selector: 'app-employee-profile-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './employee-profile-page.html',
})
export class EmployeeProfilePage {
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly employeesApi = inject(EmployeesApiService);
  private readonly servicesApi = inject(ServicesApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageEmployees = this.permissionService.can('employees:manage');
  readonly statusLabels = EMPLOYEE_STATUS_LABELS;
  readonly statuses: EmployeeStatus[] = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'];
  readonly dayLabels = DAY_OF_WEEK_LABELS;

  readonly employeeId = this.route.snapshot.paramMap.get('id')!;

  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly allServices = signal<Service[]>([]);

  // --- Profile ---
  readonly isSavingProfile = signal(false);
  readonly profileError = signal<string | null>(null);
  readonly profileSaved = signal(false);
  readonly profileForm = this.formBuilder.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    phoneNumber: [''],
    status: ['ACTIVE' as EmployeeStatus, Validators.required],
    colorTag: ['', Validators.pattern(HEX_COLOR_PATTERN)],
    bio: [''],
  });

  // --- Working hours ---
  readonly isSavingHours = signal(false);
  readonly hoursError = signal<string | null>(null);
  readonly hoursSaved = signal(false);
  readonly hoursForm = this.formBuilder.group({
    entries: this.formBuilder.array<ReturnType<typeof this.buildHoursEntry>>([]),
  });

  get hoursEntries() {
    return this.hoursForm.controls.entries;
  }

  // --- Time off ---
  readonly timeOff = signal<EmployeeTimeOff[]>([]);
  readonly isCreatingTimeOff = signal(false);
  readonly timeOffError = signal<string | null>(null);
  readonly timeOffForm = this.formBuilder.nonNullable.group({
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    reason: [''],
  });

  // --- Service assignment ---
  readonly selectedServiceIds = signal<Set<string>>(new Set());
  readonly isSavingServices = signal(false);
  readonly servicesError = signal<string | null>(null);
  readonly servicesSaved = signal(false);

  constructor() {
    this.load();
  }

  private buildHoursEntry(entry?: WorkingHoursEntry) {
    return this.formBuilder.nonNullable.group({
      dayOfWeek: [
        entry?.dayOfWeek ?? 1,
        [Validators.required, Validators.min(0), Validators.max(6)],
      ],
      startTime: [
        entry?.startTime ?? '09:00',
        [Validators.required, Validators.pattern(HH_MM_PATTERN)],
      ],
      endTime: [
        entry?.endTime ?? '17:00',
        [Validators.required, Validators.pattern(HH_MM_PATTERN)],
      ],
      isActive: [entry?.isActive ?? true],
    });
  }

  private load(): void {
    this.isLoading.set(true);
    forkJoin({
      employee: this.employeesApi.getEmployee(this.employeeId),
      workingHours: this.employeesApi.getWorkingHours(this.employeeId),
      timeOff: this.employeesApi.listTimeOff(this.employeeId),
      services: this.servicesApi.listServices(),
    }).subscribe({
      next: ({ employee, workingHours, timeOff, services }) => {
        this.applyEmployee(employee);
        for (const entry of workingHours) {
          this.hoursEntries.push(this.buildHoursEntry(entry));
        }
        this.timeOff.set(timeOff);
        this.allServices.set(services);
        this.selectedServiceIds.set(new Set(employee.serviceIds));
        this.isLoading.set(false);
      },
      error: () => {
        this.loadError.set('Could not load this employee.');
        this.isLoading.set(false);
      },
    });
  }

  private applyEmployee(employee: Employee): void {
    this.profileForm.patchValue({
      firstName: employee.firstName,
      lastName: employee.lastName,
      phoneNumber: employee.phoneNumber ?? '',
      status: employee.status,
      colorTag: employee.colorTag ?? '',
      bio: employee.bio ?? '',
    });
  }

  saveProfile(): void {
    if (this.profileForm.invalid || this.isSavingProfile()) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.isSavingProfile.set(true);
    this.profileError.set(null);
    this.profileSaved.set(false);

    const raw = this.profileForm.getRawValue();
    this.employeesApi
      .updateEmployee(this.employeeId, {
        firstName: raw.firstName,
        lastName: raw.lastName,
        phoneNumber: raw.phoneNumber || undefined,
        status: raw.status,
        colorTag: raw.colorTag || undefined,
        bio: raw.bio || undefined,
      })
      .subscribe({
        next: () => {
          this.isSavingProfile.set(false);
          this.profileSaved.set(true);
        },
        error: (error: unknown) => {
          this.isSavingProfile.set(false);
          this.profileError.set(
            error instanceof ApiError ? error.message : 'Could not save profile.',
          );
        },
      });
  }

  addHoursEntry(): void {
    this.hoursEntries.push(this.buildHoursEntry());
  }

  removeHoursEntry(index: number): void {
    this.hoursEntries.removeAt(index);
  }

  saveWorkingHours(): void {
    if (this.hoursForm.invalid || this.isSavingHours()) {
      this.hoursForm.markAllAsTouched();
      return;
    }
    const entries = this.hoursEntries.getRawValue();
    const invalid = entries.some((entry) => entry.isActive && entry.endTime <= entry.startTime);
    if (invalid) {
      this.hoursError.set('End time must be after start time for every active entry.');
      return;
    }

    this.isSavingHours.set(true);
    this.hoursError.set(null);
    this.hoursSaved.set(false);

    this.employeesApi.updateWorkingHours(this.employeeId, entries).subscribe({
      next: () => {
        this.isSavingHours.set(false);
        this.hoursSaved.set(true);
      },
      error: (error: unknown) => {
        this.isSavingHours.set(false);
        this.hoursError.set(
          error instanceof ApiError ? error.message : 'Could not save working hours.',
        );
      },
    });
  }

  createTimeOff(): void {
    if (this.timeOffForm.invalid || this.isCreatingTimeOff()) {
      this.timeOffForm.markAllAsTouched();
      return;
    }
    this.isCreatingTimeOff.set(true);
    this.timeOffError.set(null);

    const raw = this.timeOffForm.getRawValue();
    this.employeesApi
      .createTimeOff(this.employeeId, {
        startDate: raw.startDate,
        endDate: raw.endDate,
        reason: raw.reason || undefined,
      })
      .subscribe({
        next: (entry) => {
          this.isCreatingTimeOff.set(false);
          this.timeOff.update((current) =>
            [...current, entry].sort((a, b) => a.startDate.localeCompare(b.startDate)),
          );
          this.timeOffForm.reset({ startDate: '', endDate: '', reason: '' });
        },
        error: (error: unknown) => {
          this.isCreatingTimeOff.set(false);
          this.timeOffError.set(
            error instanceof ApiError ? error.message : 'Could not add time off.',
          );
        },
      });
  }

  deleteTimeOff(entry: EmployeeTimeOff): void {
    if (!confirm(`Delete time off from ${entry.startDate} to ${entry.endDate}?`)) {
      return;
    }
    this.employeesApi.deleteTimeOff(this.employeeId, entry.id).subscribe({
      next: () => {
        this.timeOff.update((current) => current.filter((t) => t.id !== entry.id));
      },
    });
  }

  toggleService(serviceId: string): void {
    this.selectedServiceIds.update((current) => {
      const next = new Set(current);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  }

  isServiceSelected(serviceId: string): boolean {
    return this.selectedServiceIds().has(serviceId);
  }

  saveServiceAssignment(): void {
    if (this.isSavingServices()) {
      return;
    }
    this.isSavingServices.set(true);
    this.servicesError.set(null);
    this.servicesSaved.set(false);

    this.employeesApi
      .assignServices(this.employeeId, Array.from(this.selectedServiceIds()))
      .subscribe({
        next: () => {
          this.isSavingServices.set(false);
          this.servicesSaved.set(true);
        },
        error: (error: unknown) => {
          this.isSavingServices.set(false);
          this.servicesError.set(
            error instanceof ApiError ? error.message : 'Could not save service assignment.',
          );
        },
      });
  }
}
