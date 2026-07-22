import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Typed, named business-rule exceptions (same convention as
 * `modules/tenants/application/exceptions/tenant.exceptions.ts`) — the
 * global exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const SALON_ERROR_CODES = {
  DUPLICATE_HOLIDAY_DATE: 'DUPLICATE_HOLIDAY_DATE',
  INVALID_BUSINESS_HOURS_SET: 'INVALID_BUSINESS_HOURS_SET',
  NO_UPDATE_FIELDS_PROVIDED: 'NO_UPDATE_FIELDS_PROVIDED',
} as const;

export class DuplicateHolidayDateException extends ConflictException {
  constructor(date: string) {
    super({
      code: SALON_ERROR_CODES.DUPLICATE_HOLIDAY_DATE,
      message: `A holiday already exists on ${date}.`,
      details: [{ field: 'date', issue: 'duplicate', date }],
    });
  }
}

export class InvalidBusinessHoursSetException extends UnprocessableEntityException {
  constructor(message: string) {
    super({
      code: SALON_ERROR_CODES.INVALID_BUSINESS_HOURS_SET,
      message,
      details: [],
    });
  }
}

export class NoUpdateFieldsProvidedException extends UnprocessableEntityException {
  constructor() {
    super({
      code: SALON_ERROR_CODES.NO_UPDATE_FIELDS_PROVIDED,
      message: 'At least one field must be provided.',
      details: [],
    });
  }
}
