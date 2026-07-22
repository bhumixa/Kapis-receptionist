import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api-client';
import { Employee, EmployeeStatus } from '../../shared/models/employee.model';
import { WorkingHoursEntry } from '../../shared/models/working-hours.model';
import { EmployeeTimeOff } from '../../shared/models/employee-time-off.model';

export interface CreateEmployeeRequest {
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  colorTag?: string;
  bio?: string;
  userId?: string;
  serviceIds?: string[];
}

export type UpdateEmployeeRequest = Partial<Omit<CreateEmployeeRequest, 'userId'>> & {
  status?: EmployeeStatus;
  userId?: string | null;
};

export interface CreateTimeOffRequest {
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface MessageResponse {
  message: string;
}

/**
 * `/employees[/:id]`, `/employees/:id/working-hours`,
 * `/employees/:id/time-off[/:id]`, `/employees/:id/services`
 * (docs/WORKFORCE_ARCHITECTURE.md). Thin HTTP wrapper only, no state —
 * mirrors `SalonApiService`'s pattern. Fetches a single generous-limit page
 * for the employee list (no pagination UI yet), same precedent as
 * `AdminApiService.listTenants`.
 */
@Injectable({ providedIn: 'root' })
export class EmployeesApiService {
  private readonly api = inject(ApiClient);

  listEmployees(serviceId?: string): Observable<Employee[]> {
    return this.api.get<Employee[]>('/employees', {
      params: serviceId ? { limit: 100, serviceId } : { limit: 100 },
    });
  }

  getEmployee(id: string): Observable<Employee> {
    return this.api.get<Employee>(`/employees/${id}`);
  }

  createEmployee(request: CreateEmployeeRequest): Observable<Employee> {
    return this.api.post<Employee>('/employees', request);
  }

  updateEmployee(id: string, request: UpdateEmployeeRequest): Observable<Employee> {
    return this.api.patch<Employee>(`/employees/${id}`, request);
  }

  deleteEmployee(id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/employees/${id}`);
  }

  assignServices(id: string, serviceIds: string[]): Observable<{ serviceIds: string[] }> {
    return this.api.put<{ serviceIds: string[] }>(`/employees/${id}/services`, {
      serviceIds,
    });
  }

  getWorkingHours(employeeId: string): Observable<WorkingHoursEntry[]> {
    return this.api.get<WorkingHoursEntry[]>(`/employees/${employeeId}/working-hours`);
  }

  updateWorkingHours(
    employeeId: string,
    entries: WorkingHoursEntry[],
  ): Observable<WorkingHoursEntry[]> {
    return this.api.put<WorkingHoursEntry[]>(`/employees/${employeeId}/working-hours`, { entries });
  }

  listTimeOff(employeeId: string): Observable<EmployeeTimeOff[]> {
    return this.api.get<EmployeeTimeOff[]>(`/employees/${employeeId}/time-off`);
  }

  createTimeOff(employeeId: string, request: CreateTimeOffRequest): Observable<EmployeeTimeOff> {
    return this.api.post<EmployeeTimeOff>(`/employees/${employeeId}/time-off`, request);
  }

  deleteTimeOff(employeeId: string, id: string): Observable<MessageResponse> {
    return this.api.delete<MessageResponse>(`/employees/${employeeId}/time-off/${id}`);
  }
}
