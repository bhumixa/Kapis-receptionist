import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Appointment, AppointmentStatus } from '../../shared/models/appointment.model';
import { AvailabilitySlot } from '../../shared/models/availability.model';

export interface AppointmentServiceLineRequest {
  serviceId: string;
  employeeId: string;
}

export interface CreateAppointmentRequest {
  customerId: string;
  startTime: string;
  services: AppointmentServiceLineRequest[];
  notes?: string;
}

export interface RescheduleAppointmentRequest {
  newStartTime: string;
  services?: AppointmentServiceLineRequest[];
}

export interface ListAppointmentsFilter {
  status?: AppointmentStatus[];
  employeeId?: string;
  customerId?: string;
  startTimeFrom?: string;
  startTimeTo?: string;
}

export interface GetAvailabilityRequest {
  serviceId: string;
  employeeId?: string;
  dateFrom: string;
  dateTo: string;
}

export interface RescheduleResponse {
  originalAppointment: Appointment;
  newAppointment: Appointment;
  warnings: string[];
}

export interface CancelResponse extends Appointment {
  warnings: string[];
}

export interface MessageResponse {
  message: string;
}

/**
 * `/appointments[/:id]`, `.../cancel`, `.../reschedule`,
 * `/appointments/availability` (API_SPECIFICATION.md Section 10, docs/adr/
 * ADR-009-scheduling-engine.md). Every booking-critical write generates and
 * attaches its own `Idempotency-Key` (Section 2.13) — a fresh key per user
 * action, not reused across retries the browser itself might make, so a
 * genuinely new user click always gets a new key while this service's own
 * internal retry (none today) would reuse one.
 */
@Injectable({ providedIn: 'root' })
export class AppointmentsApiService {
  private readonly api = inject(ApiClient);

  listAppointments(filter: ListAppointmentsFilter): Observable<Appointment[]> {
    const params: Record<string, string | number | boolean> = { limit: 100 };
    if (filter.status?.length) {
      params['status'] = filter.status.join(',');
    }
    if (filter.employeeId) {
      params['employeeId'] = filter.employeeId;
    }
    if (filter.customerId) {
      params['customerId'] = filter.customerId;
    }
    if (filter.startTimeFrom) {
      params['startTimeFrom'] = filter.startTimeFrom;
    }
    if (filter.startTimeTo) {
      params['startTimeTo'] = filter.startTimeTo;
    }
    return this.api.get<Appointment[]>('/appointments', { params });
  }

  getAppointment(id: string): Observable<Appointment> {
    return this.api.get<Appointment>(`/appointments/${id}`);
  }

  createAppointment(request: CreateAppointmentRequest): Observable<Appointment> {
    return this.api.post<Appointment>('/appointments', request, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  }

  updateNotes(id: string, notes: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/appointments/${id}`, { notes });
  }

  cancelAppointment(id: string, reason?: string): Observable<CancelResponse> {
    return this.api.post<CancelResponse>(
      `/appointments/${id}/cancel`,
      { reason },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    );
  }

  rescheduleAppointment(
    id: string,
    request: RescheduleAppointmentRequest,
  ): Observable<RescheduleResponse> {
    return this.api.post<RescheduleResponse>(`/appointments/${id}/reschedule`, request, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  }

  deleteAppointment(id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/appointments/${id}`);
  }

  getAvailability(request: GetAvailabilityRequest): Observable<AvailabilitySlot[]> {
    return this.api.get<AvailabilitySlot[]>('/appointments/availability', {
      params: {
        serviceId: request.serviceId,
        ...(request.employeeId ? { employeeId: request.employeeId } : {}),
        dateFrom: request.dateFrom,
        dateTo: request.dateTo,
      },
    });
  }
}
