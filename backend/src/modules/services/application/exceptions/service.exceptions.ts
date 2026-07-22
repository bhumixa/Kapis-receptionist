import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Typed, named business-rule exceptions (same convention as
 * `modules/salon/application/exceptions/salon.exceptions.ts`) — the global
 * exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const SERVICE_ERROR_CODES = {
  INVALID_CATEGORY_REFERENCE: 'INVALID_CATEGORY_REFERENCE',
  NO_UPDATE_FIELDS_PROVIDED: 'NO_UPDATE_FIELDS_PROVIDED',
} as const;

export class InvalidCategoryReferenceException extends UnprocessableEntityException {
  constructor(categoryId: string) {
    super({
      code: SERVICE_ERROR_CODES.INVALID_CATEGORY_REFERENCE,
      message: `categoryId "${categoryId}" does not belong to this tenant.`,
      details: [{ field: 'categoryId', issue: 'not_found_in_tenant' }],
    });
  }
}

export class NoUpdateFieldsProvidedException extends BadRequestException {
  constructor() {
    super({
      code: SERVICE_ERROR_CODES.NO_UPDATE_FIELDS_PROVIDED,
      message: 'At least one field must be provided.',
      details: [],
    });
  }
}
