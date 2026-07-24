import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError } from '../../../../core/api/api-error';
import { CustomersApiService } from '../../../../core/api/customers-api.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import { Customer } from '../../../../shared/models/customer.model';

/** `/app/customers` (API_SPECIFICATION.md Section 9) — search, inline create/edit, mirrors `EmployeesListPage`'s flattened pattern. */
@Component({
  selector: 'app-customers-list-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customers-list-page.html',
})
export class CustomersListPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly customersApi = inject(CustomersApiService);
  private readonly permissionService = inject(PermissionService);

  readonly canManageCustomers = this.permissionService.can('customers:manage');

  readonly customers = signal<Customer[]>([]);
  readonly isLoading = signal(true);
  readonly searchTerm = signal('');
  private searchDebounce?: ReturnType<typeof setTimeout>;

  readonly editingId = signal<string | null>(null);
  readonly editForm = this.formBuilder.nonNullable.group({
    firstName: [''],
    lastName: [''],
    email: [''],
  });

  readonly isCreating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = this.formBuilder.nonNullable.group({
    phoneNumber: ['', [Validators.required, Validators.pattern(/^\+[1-9]\d{1,14}$/)]],
    firstName: [''],
    lastName: [''],
  });

  constructor() {
    this.load();
  }

  onSearchInput(value: string): void {
    this.searchTerm.set(value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.load(), 300);
  }

  private load(): void {
    this.isLoading.set(true);
    this.customersApi.listCustomers(this.searchTerm() || undefined).subscribe({
      next: (customers) => {
        this.customers.set(customers);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  createCustomer(): void {
    if (this.createForm.invalid || this.isCreating()) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.isCreating.set(true);
    this.createError.set(null);

    const raw = this.createForm.getRawValue();
    this.customersApi
      .createCustomer({
        phoneNumber: raw.phoneNumber,
        firstName: raw.firstName || undefined,
        lastName: raw.lastName || undefined,
      })
      .subscribe({
        next: (customer) => {
          this.isCreating.set(false);
          this.customers.update((current) => [customer, ...current]);
          this.createForm.reset({ phoneNumber: '', firstName: '', lastName: '' });
        },
        error: (error: unknown) => {
          this.isCreating.set(false);
          this.createError.set(
            error instanceof ApiError ? error.message : 'Could not add the customer.',
          );
        },
      });
  }

  startEdit(customer: Customer): void {
    this.editingId.set(customer.id);
    this.editForm.setValue({
      firstName: customer.firstName ?? '',
      lastName: customer.lastName ?? '',
      email: customer.email ?? '',
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(customer: Customer): void {
    const raw = this.editForm.getRawValue();
    this.customersApi
      .updateCustomer(customer.id, {
        firstName: raw.firstName || undefined,
        lastName: raw.lastName || undefined,
        email: raw.email || undefined,
      })
      .subscribe({
        next: (updated) => {
          this.customers.update((current) =>
            current.map((c) => (c.id === updated.id ? updated : c)),
          );
          this.editingId.set(null);
        },
      });
  }

  deleteCustomer(customer: Customer): void {
    const label = customer.firstName
      ? `${customer.firstName} ${customer.lastName ?? ''}`.trim()
      : customer.phoneNumber;
    if (!confirm(`Remove ${label}?`)) {
      return;
    }
    this.customersApi.deleteCustomer(customer.id).subscribe({
      next: () => {
        this.customers.update((current) => current.filter((c) => c.id !== customer.id));
      },
    });
  }
}
