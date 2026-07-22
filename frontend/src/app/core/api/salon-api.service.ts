import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { BusinessHoursDay } from '../../shared/models/business-hours.model';
import { Holiday } from '../../shared/models/holiday.model';
import { SalonProfile } from '../../shared/models/salon.model';

export type UpdateSalonProfileRequest = Partial<Omit<SalonProfile, 'updatedAt'>>;

export interface CreateHolidayRequest {
  date: string;
  reason: string;
}

export type UpdateHolidayRequest = Partial<CreateHolidayRequest>;

export interface MessageResponse {
  message: string;
}

/**
 * `GET/PATCH /salon`, `GET/PUT /salon/business-hours`,
 * `/salon/holidays/*` (docs/SALON_ARCHITECTURE.md). Thin HTTP wrapper
 * only, no state — mirrors `TenantApiService`'s same pattern.
 */
@Injectable({ providedIn: 'root' })
export class SalonApiService {
  private readonly api = inject(ApiClient);

  getProfile(): Observable<SalonProfile> {
    return this.api.get<SalonProfile>('/salon');
  }

  updateProfile(request: UpdateSalonProfileRequest): Observable<SalonProfile> {
    return this.api.patch<SalonProfile>('/salon', request);
  }

  getBusinessHours(): Observable<BusinessHoursDay[]> {
    return this.api.get<BusinessHoursDay[]>('/salon/business-hours');
  }

  updateBusinessHours(days: BusinessHoursDay[]): Observable<BusinessHoursDay[]> {
    return this.api.put<BusinessHoursDay[]>('/salon/business-hours', { days });
  }

  listHolidays(): Observable<Holiday[]> {
    return this.api.get<Holiday[]>('/salon/holidays');
  }

  createHoliday(request: CreateHolidayRequest): Observable<Holiday> {
    return this.api.post<Holiday>('/salon/holidays', request);
  }

  updateHoliday(id: string, request: UpdateHolidayRequest): Observable<Holiday> {
    return this.api.patch<Holiday>(`/salon/holidays/${id}`, request);
  }

  deleteHoliday(id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/salon/holidays/${id}`);
  }
}
