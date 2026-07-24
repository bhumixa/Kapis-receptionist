import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Typed, named business-rule exceptions (same convention as `modules/
 * services/application/exceptions/service.exceptions.ts`) — the global
 * exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const APPOINTMENT_ERROR_CODES = {
  SLOT_NO_LONGER_AVAILABLE: 'SLOT_NO_LONGER_AVAILABLE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  INVALID_CUSTOMER_REFERENCE: 'INVALID_CUSTOMER_REFERENCE',
  INVALID_EMPLOYEE_REFERENCE: 'INVALID_EMPLOYEE_REFERENCE',
  EMPTY_SERVICE_LINES: 'EMPTY_SERVICE_LINES',
  NO_UPDATE_FIELDS_PROVIDED: 'NO_UPDATE_FIELDS_PROVIDED',
} as const;

/**
 * API_SPECIFICATION.md Section 10's most important error — the concurrent-
 * booking race condition surfaced as a clear, actionable client error
 * (DATABASE_DESIGN.md Risk DB-R3) rather than a generic `409 CONFLICT`.
 * Thrown when the Redis lock is already held, the pre-flight availability
 * check fails, or the database-level `EXCLUDE` constraint rejects the
 * insert (the two-layer conflict-prevention mechanism, docs/adr/
 * ADR-009-scheduling-engine.md).
 */
export class SlotNoLongerAvailableException extends ConflictException {
  constructor(employeeId?: string) {
    super({
      code: APPOINTMENT_ERROR_CODES.SLOT_NO_LONGER_AVAILABLE,
      message: 'The requested time slot is no longer available.',
      details: employeeId ? [{ employeeId }] : [],
    });
  }
}

export class InvalidStatusTransitionException extends ConflictException {
  constructor(message: string) {
    super({
      code: APPOINTMENT_ERROR_CODES.INVALID_STATUS_TRANSITION,
      message,
      details: [],
    });
  }
}

export class InvalidCustomerReferenceException extends UnprocessableEntityException {
  constructor(customerId: string) {
    super({
      code: APPOINTMENT_ERROR_CODES.INVALID_CUSTOMER_REFERENCE,
      message: `customerId "${customerId}" does not belong to this tenant.`,
      details: [{ field: 'customerId', issue: 'not_found_in_tenant' }],
    });
  }
}

export class InvalidEmployeeReferenceException extends UnprocessableEntityException {
  constructor(employeeId: string, reason: string) {
    super({
      code: APPOINTMENT_ERROR_CODES.INVALID_EMPLOYEE_REFERENCE,
      message: `employeeId "${employeeId}" is invalid: ${reason}.`,
      details: [{ field: 'employeeId', issue: reason }],
    });
  }
}

export class InvalidServiceReferenceException extends UnprocessableEntityException {
  constructor(serviceId: string) {
    super({
      code: 'INVALID_SERVICE_REFERENCE',
      message: `serviceId "${serviceId}" does not belong to this tenant.`,
      details: [{ field: 'serviceId', issue: 'not_found_in_tenant' }],
    });
  }
}

/** PROJECT_REQUIREMENTS.md Business Rule 11 / API_SPECIFICATION.md Section 10's STAFF-scoping rule — 403, never 404, since the resource genuinely exists within the same tenant. */
export class StaffScopeForbiddenException extends ForbiddenException {
  constructor() {
    super({
      code: 'FORBIDDEN',
      message: 'You may only access your own appointments.',
      details: [],
    });
  }
}

export class EmptyServiceLinesException extends UnprocessableEntityException {
  constructor() {
    super({
      code: APPOINTMENT_ERROR_CODES.EMPTY_SERVICE_LINES,
      message: 'At least one service line is required.',
      details: [{ field: 'services', issue: 'empty' }],
    });
  }
}

export class NoUpdateFieldsProvidedException extends BadRequestException {
  constructor() {
    super({
      code: APPOINTMENT_ERROR_CODES.NO_UPDATE_FIELDS_PROVIDED,
      message: 'At least one field must be provided.',
      details: [],
    });
  }
}
