import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Typed, named business-rule exceptions (same convention as
 * `modules/salon/application/exceptions/salon.exceptions.ts`) — the global
 * exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const EMPLOYEE_ERROR_CODES = {
  INVALID_SERVICE_REFERENCE: 'INVALID_SERVICE_REFERENCE',
  INVALID_USER_REFERENCE: 'INVALID_USER_REFERENCE',
  USER_ALREADY_LINKED: 'USER_ALREADY_LINKED',
  INVALID_WORKING_HOURS_ENTRY: 'INVALID_WORKING_HOURS_ENTRY',
  INVALID_TIME_OFF_RANGE: 'INVALID_TIME_OFF_RANGE',
  NO_UPDATE_FIELDS_PROVIDED: 'NO_UPDATE_FIELDS_PROVIDED',
} as const;

export class InvalidServiceReferenceException extends UnprocessableEntityException {
  constructor(serviceIds: string[]) {
    super({
      code: EMPLOYEE_ERROR_CODES.INVALID_SERVICE_REFERENCE,
      message: 'One or more serviceIds do not belong to this tenant.',
      details: [
        { field: 'serviceIds', issue: 'not_found_in_tenant', serviceIds },
      ],
    });
  }
}

export class InvalidUserReferenceException extends UnprocessableEntityException {
  constructor() {
    super({
      code: EMPLOYEE_ERROR_CODES.INVALID_USER_REFERENCE,
      message: 'userId does not reference an existing user in this tenant.',
      details: [{ field: 'userId', issue: 'not_found_in_tenant' }],
    });
  }
}

export class UserAlreadyLinkedException extends ConflictException {
  constructor() {
    super({
      code: EMPLOYEE_ERROR_CODES.USER_ALREADY_LINKED,
      message: 'This user is already linked to another employee.',
      details: [{ field: 'userId', issue: 'already_linked' }],
    });
  }
}

export class InvalidWorkingHoursEntryException extends UnprocessableEntityException {
  constructor(message: string) {
    super({
      code: EMPLOYEE_ERROR_CODES.INVALID_WORKING_HOURS_ENTRY,
      message,
      details: [],
    });
  }
}

export class InvalidTimeOffRangeException extends UnprocessableEntityException {
  constructor() {
    super({
      code: EMPLOYEE_ERROR_CODES.INVALID_TIME_OFF_RANGE,
      message: 'endDate must be on or after startDate.',
      details: [{ field: 'endDate', issue: 'before_start_date' }],
    });
  }
}

export class NoUpdateFieldsProvidedException extends BadRequestException {
  constructor() {
    super({
      code: EMPLOYEE_ERROR_CODES.NO_UPDATE_FIELDS_PROVIDED,
      message: 'At least one field must be provided.',
      details: [],
    });
  }
}
