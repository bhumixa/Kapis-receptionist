/** One bookable `(employeeId, startTime)` candidate (API_SPECIFICATION.md Section 10, `GET /appointments/availability`). */
export interface AvailabilitySlotEntity {
  employeeId: string;
  employeeName: string;
  startTime: Date;
  endTime: Date;
}

/** A single continuous window an employee is working within one calendar day, already net of holidays/time-off/business-hours closure. */
export interface WorkingWindow {
  start: Date;
  end: Date;
}
