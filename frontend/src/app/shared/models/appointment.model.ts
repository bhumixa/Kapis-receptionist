/** Mirrors `backend/src/modules/appointments/interface/dto/appointment-response.dto.ts`. */
export type AppointmentStatus =
  'PENDING' | 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

export interface AppointmentServiceLine {
  id: string;
  serviceId: string;
  employeeId: string;
  serviceNameSnapshot: string;
  durationMinutesSnapshot: number;
  priceCentsSnapshot: number;
  bufferMinutesSnapshot: number;
  sequenceOrder: number;
  startTime: string;
  endTime: string;
}

export interface Appointment {
  id: string;
  customerId: string;
  employeeId: string;
  status: AppointmentStatus;
  startTime: string;
  endTime: string;
  totalPriceCents: number;
  currency: string;
  notes: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  rescheduledFromAppointmentId: string | null;
  services: AppointmentServiceLine[];
  createdAt: string;
  updatedAt: string;
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
};
