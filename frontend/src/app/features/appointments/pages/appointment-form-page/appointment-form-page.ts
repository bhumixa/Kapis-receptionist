import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiError } from '../../../../core/api/api-error';
import { AppointmentsApiService } from '../../../../core/api/appointments-api.service';
import { CustomersApiService } from '../../../../core/api/customers-api.service';
import { EmployeesApiService } from '../../../../core/api/employees-api.service';
import { ServicesApiService } from '../../../../core/api/services-api.service';
import { Customer } from '../../../../shared/models/customer.model';
import { Employee } from '../../../../shared/models/employee.model';
import { Service } from '../../../../shared/models/service.model';
import { AvailabilitySlot } from '../../../../shared/models/availability.model';

/**
 * `/app/appointments/new` (API_SPECIFICATION.md Section 10, docs/adr/
 * ADR-009-scheduling-engine.md). Per-service employee assignment: each
 * service line picks its own eligible employee (`GET /employees?serviceId=`,
 * already supported by `EmployeesApiService`), not one employee for the
 * whole visit.
 */
@Component({
  selector: 'app-appointment-form-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './appointment-form-page.html',
})
export class AppointmentFormPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly appointmentsApi = inject(AppointmentsApiService);
  private readonly customersApi = inject(CustomersApiService);
  private readonly employeesApi = inject(EmployeesApiService);
  private readonly servicesApi = inject(ServicesApiService);
  private readonly router = inject(Router);

  readonly services = signal<Service[]>([]);
  readonly employeeOptionsByLine = signal<Record<number, Employee[]>>({});

  readonly customerSearch = signal('');
  readonly customerResults = signal<Customer[]>([]);
  readonly selectedCustomer = signal<Customer | null>(null);
  private customerSearchDebounce?: ReturnType<typeof setTimeout>;

  readonly availabilitySlots = signal<AvailabilitySlot[]>([]);
  readonly isCheckingAvailability = signal(false);

  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly form = this.formBuilder.group({
    date: ['', Validators.required],
    time: ['', Validators.required],
    notes: [''],
    lines: this.formBuilder.array([this.buildLineGroup()]),
  });

  get lines() {
    return this.form.controls.lines;
  }

  private buildLineGroup() {
    return this.formBuilder.nonNullable.group({
      serviceId: ['', Validators.required],
      employeeId: ['', Validators.required],
    });
  }

  constructor() {
    this.servicesApi.listServices().subscribe({ next: (services) => this.services.set(services) });
  }

  onCustomerSearchInput(value: string): void {
    this.customerSearch.set(value);
    this.selectedCustomer.set(null);
    clearTimeout(this.customerSearchDebounce);
    if (!value.trim()) {
      this.customerResults.set([]);
      return;
    }
    this.customerSearchDebounce = setTimeout(() => {
      this.customersApi.listCustomers(value).subscribe({
        next: (customers) => this.customerResults.set(customers),
      });
    }, 300);
  }

  selectCustomer(customer: Customer): void {
    this.selectedCustomer.set(customer);
    this.customerResults.set([]);
  }

  addLine(): void {
    this.lines.push(this.buildLineGroup());
  }

  removeLine(index: number): void {
    if (this.lines.length <= 1) {
      return;
    }
    this.lines.removeAt(index);
  }

  employeeOptionsFor(index: number): Employee[] {
    const options: Employee[] | undefined = this.employeeOptionsByLine()[index];
    return options ?? [];
  }

  onLineServiceChange(index: number, serviceId: string): void {
    this.lines.at(index).patchValue({ employeeId: '' });
    this.availabilitySlots.set([]);
    if (!serviceId) {
      return;
    }
    this.employeesApi.listEmployees(serviceId).subscribe({
      next: (employees) => {
        this.employeeOptionsByLine.update((current) => ({ ...current, [index]: employees }));
      },
    });
  }

  checkAvailability(): void {
    const firstLine = this.lines.at(0).getRawValue();
    const date = this.form.controls.date.value;
    if (!firstLine.serviceId || !date) {
      return;
    }
    this.isCheckingAvailability.set(true);
    this.appointmentsApi
      .getAvailability({
        serviceId: firstLine.serviceId,
        employeeId: firstLine.employeeId || undefined,
        dateFrom: date,
        dateTo: date,
      })
      .subscribe({
        next: (slots) => {
          this.availabilitySlots.set(slots);
          this.isCheckingAvailability.set(false);
        },
        error: () => this.isCheckingAvailability.set(false),
      });
  }

  pickSlot(slot: AvailabilitySlot): void {
    const time = slot.startTime.slice(11, 16);
    this.form.patchValue({ time });
    this.lines.at(0).patchValue({ employeeId: slot.employeeId });
  }

  submit(): void {
    if (this.form.invalid || !this.selectedCustomer() || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const startTime = new Date(`${raw.date}T${raw.time}:00.000Z`).toISOString();

    this.isSubmitting.set(true);
    this.submitError.set(null);

    this.appointmentsApi
      .createAppointment({
        customerId: this.selectedCustomer()!.id,
        startTime,
        services: this.lines.getRawValue().map((line) => ({
          serviceId: line.serviceId,
          employeeId: line.employeeId,
        })),
        notes: raw.notes || undefined,
      })
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          void this.router.navigate(['/app/appointments']);
        },
        error: (error: unknown) => {
          this.isSubmitting.set(false);
          this.submitError.set(
            error instanceof ApiError ? error.message : 'Could not create the appointment.',
          );
        },
      });
  }
}
