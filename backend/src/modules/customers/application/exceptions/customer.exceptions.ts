import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Typed, named business-rule exceptions (same convention as
 * `modules/services/application/exceptions/service.exceptions.ts`) — the
 * global exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const CUSTOMER_ERROR_CODES = {
  PHONE_NUMBER_ALREADY_EXISTS: 'PHONE_NUMBER_ALREADY_EXISTS',
  NO_UPDATE_FIELDS_PROVIDED: 'NO_UPDATE_FIELDS_PROVIDED',
} as const;

/**
 * API_SPECIFICATION.md Section 9's `POST /customers` — carries the existing
 * `customerId` in `details` so the frontend can offer "view existing
 * customer" instead of a dead-end error.
 */
export class PhoneNumberAlreadyExistsException extends ConflictException {
  constructor(existingCustomerId: string) {
    super({
      code: CUSTOMER_ERROR_CODES.PHONE_NUMBER_ALREADY_EXISTS,
      message: 'A customer with this phone number already exists.',
      details: [{ field: 'phoneNumber', customerId: existingCustomerId }],
    });
  }
}

export class NoUpdateFieldsProvidedException extends BadRequestException {
  constructor() {
    super({
      code: CUSTOMER_ERROR_CODES.NO_UPDATE_FIELDS_PROVIDED,
      message: 'At least one field must be provided.',
      details: [],
    });
  }
}
