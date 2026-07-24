import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppointmentsApiService } from '../../../../core/api/appointments-api.service';
import { EmployeesApiService } from '../../../../core/api/employees-api.service';
import { CustomersApiService } from '../../../../core/api/customers-api.service';
import {
  Appointment,
  APPOINTMENT_STATUS_LABELS,
} from '../../../../shared/models/appointment.model';
import { Employee } from '../../../../shared/models/employee.model';
import { Customer } from '../../../../shared/models/customer.model';

type ViewMode = 'day' | 'week';

interface DayColumn {
  dateKey: string;
  label: string;
  appointments: Appointment[];
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date): Date {
  const start = startOfUtcDay(date);
  const dayOfWeek = start.getUTCDay(); // 0=Sunday
  start.setUTCDate(start.getUTCDate() - dayOfWeek);
  return start;
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * `/app/appointments` (docs/CALENDAR_ENGINE.md) — Day/Week calendar,
 * one column per calendar day (not per employee — see CALENDAR_ENGINE.md's
 * rationale). Drag-and-drop between day columns reschedules an appointment
 * to the new date, preserving its original time-of-day.
 */
@Component({
  selector: 'app-appointments-calendar-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './appointments-calendar-page.html',
})
export class AppointmentsCalendarPage {
  private readonly appointmentsApi = inject(AppointmentsApiService);
  private readonly employeesApi = inject(EmployeesApiService);
  private readonly customersApi = inject(CustomersApiService);

  readonly statusLabels = APPOINTMENT_STATUS_LABELS;
  readonly viewMode = signal<ViewMode>('week');
  readonly anchorDate = signal<Date>(startOfUtcDay(new Date()));

  readonly appointments = signal<Appointment[]>([]);
  readonly isLoading = signal(true);
  readonly draggingId = signal<string | null>(null);

  private readonly employeeById = signal<Record<string, Employee>>({});
  private readonly customerById = signal<Record<string, Customer>>({});

  readonly rangeStart = computed(() =>
    this.viewMode() === 'day' ? this.anchorDate() : startOfUtcWeek(this.anchorDate()),
  );
  readonly rangeEnd = computed(() =>
    addUtcDays(this.rangeStart(), this.viewMode() === 'day' ? 1 : 7),
  );

  readonly dayColumns = computed<DayColumn[]>(() => {
    const start = this.rangeStart();
    const dayCount = this.viewMode() === 'day' ? 1 : 7;
    const byDay = new Map<string, Appointment[]>();
    for (const appointment of this.appointments()) {
      const key = appointment.startTime.slice(0, 10);
      const list = byDay.get(key) ?? [];
      list.push(appointment);
      byDay.set(key, list);
    }
    return Array.from({ length: dayCount }, (_, i) => {
      const date = addUtcDays(start, i);
      const key = toDateKey(date);
      const list = (byDay.get(key) ?? [])
        .slice()
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      return {
        dateKey: key,
        label: date.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
        appointments: list,
      };
    });
  });

  constructor() {
    this.employeesApi.listEmployees().subscribe({
      next: (employees) => {
        this.employeeById.set(Object.fromEntries(employees.map((e) => [e.id, e])));
      },
    });
    this.load();
  }

  employeeName(employeeId: string): string {
    const employee = this.employeeById()[employeeId];
    return employee ? `${employee.firstName} ${employee.lastName}` : '—';
  }

  employeeColor(employeeId: string): string {
    return this.employeeById()[employeeId]?.colorTag ?? '#9CA3AF';
  }

  customerName(customerId: string): string {
    const customer = this.customerById()[customerId];
    if (!customer) {
      return 'Customer';
    }
    return customer.firstName || customer.lastName
      ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
      : customer.phoneNumber;
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    this.load();
  }

  goToToday(): void {
    this.anchorDate.set(startOfUtcDay(new Date()));
    this.load();
  }

  goPrevious(): void {
    this.anchorDate.set(addUtcDays(this.anchorDate(), this.viewMode() === 'day' ? -1 : -7));
    this.load();
  }

  goNext(): void {
    this.anchorDate.set(addUtcDays(this.anchorDate(), this.viewMode() === 'day' ? 1 : 7));
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.appointmentsApi
      .listAppointments({
        startTimeFrom: this.rangeStart().toISOString(),
        startTimeTo: this.rangeEnd().toISOString(),
      })
      .subscribe({
        next: (appointments) => {
          this.appointments.set(appointments);
          this.isLoading.set(false);
          this.loadMissingCustomers(appointments);
        },
        error: () => this.isLoading.set(false),
      });
  }

  private loadMissingCustomers(appointments: Appointment[]): void {
    const known = this.customerById();
    const missingIds = Array.from(new Set(appointments.map((a) => a.customerId))).filter(
      (id) => !known[id],
    );
    for (const id of missingIds) {
      this.customersApi.getCustomer(id).subscribe({
        next: (customer) => {
          this.customerById.update((current) => ({ ...current, [customer.id]: customer }));
        },
      });
    }
  }

  onDragStart(appointmentId: string, event: DragEvent): void {
    this.draggingId.set(appointmentId);
    event.dataTransfer?.setData('text/plain', appointmentId);
  }

  onDragEnd(): void {
    this.draggingId.set(null);
  }

  onDrop(targetDateKey: string, event: DragEvent): void {
    event.preventDefault();
    const appointmentId = event.dataTransfer?.getData('text/plain') ?? this.draggingId();
    this.draggingId.set(null);
    if (!appointmentId) {
      return;
    }
    const appointment = this.appointments().find((a) => a.id === appointmentId);
    if (!appointment || appointment.startTime.slice(0, 10) === targetDateKey) {
      return;
    }
    if (appointment.status !== 'PENDING' && appointment.status !== 'CONFIRMED') {
      return;
    }

    const timeOfDay = appointment.startTime.slice(11); // "HH:mm:ss.sssZ"
    const newStartTime = `${targetDateKey}T${timeOfDay}`;

    this.appointmentsApi.rescheduleAppointment(appointmentId, { newStartTime }).subscribe({
      next: (result) => {
        this.appointments.update((current) => [
          ...current.filter((a) => a.id !== appointmentId),
          result.newAppointment,
        ]);
      },
      error: () => {
        // Slot no longer available or another conflict — reload to reflect real state.
        this.load();
      },
    });
  }
}
