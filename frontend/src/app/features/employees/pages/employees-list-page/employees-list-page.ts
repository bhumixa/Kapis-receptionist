import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { EmployeesApiService } from '../../../../core/api/employees-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import { EMPLOYEE_STATUS_LABELS, Employee } from '../../../../shared/models/employee.model';

/** `/app/employees` (docs/WORKFORCE_ARCHITECTURE.md) — staff list with inline create, links out to each employee's profile page. */
@Component({
  selector: 'app-employees-list-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './employees-list-page.html',
})
export class EmployeesListPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly employeesApi = inject(EmployeesApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageEmployees = this.permissionService.can('employees:manage');
  readonly statusLabels = EMPLOYEE_STATUS_LABELS;

  readonly employees = signal<Employee[]>([]);
  readonly isLoading = signal(true);

  readonly isCreating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = this.formBuilder.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    phoneNumber: [''],
    colorTag: ['#4F46E5', Validators.pattern(/^#[0-9A-Fa-f]{6}$/)],
  });

  constructor() {
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.employeesApi.listEmployees().subscribe({
      next: (employees) => {
        this.employees.set(employees);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  createEmployee(): void {
    if (this.createForm.invalid || this.isCreating()) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.isCreating.set(true);
    this.createError.set(null);

    const raw = this.createForm.getRawValue();
    this.employeesApi
      .createEmployee({
        firstName: raw.firstName,
        lastName: raw.lastName,
        phoneNumber: raw.phoneNumber || undefined,
        colorTag: raw.colorTag || undefined,
      })
      .subscribe({
        next: (employee) => {
          this.isCreating.set(false);
          this.employees.update((current) => [...current, employee]);
          this.createForm.reset({
            firstName: '',
            lastName: '',
            phoneNumber: '',
            colorTag: '#4F46E5',
          });
        },
        error: (error: unknown) => {
          this.isCreating.set(false);
          this.createError.set(
            error instanceof ApiError ? error.message : 'Could not add the employee.',
          );
        },
      });
  }

  deleteEmployee(employee: Employee): void {
    if (!confirm(`Remove ${employee.firstName} ${employee.lastName}?`)) {
      return;
    }
    this.employeesApi.deleteEmployee(employee.id).subscribe({
      next: () => {
        this.employees.update((current) => current.filter((e) => e.id !== employee.id));
      },
    });
  }
}
