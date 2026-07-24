import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const AVAILABILITY_ERROR_CODES = {
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  DATE_RANGE_TOO_LARGE: 'DATE_RANGE_TOO_LARGE',
} as const;

/** `GET /appointments/availability` (API_SPECIFICATION.md Section 10) — the `serviceId` doesn't belong to the caller's tenant. */
export class ServiceNotFoundForAvailabilityException extends NotFoundException {
  constructor() {
    super({
      code: AVAILABILITY_ERROR_CODES.SERVICE_NOT_FOUND,
      message: 'Service not found.',
      details: [],
    });
  }
}

/** `dateTo`/`dateFrom` span more than the 31-day cap (API_SPECIFICATION.md Section 10 — bounds computation cost). */
export class DateRangeTooLargeException extends UnprocessableEntityException {
  constructor() {
    super({
      code: AVAILABILITY_ERROR_CODES.DATE_RANGE_TOO_LARGE,
      message: 'dateFrom/dateTo must span at most 31 days.',
      details: [{ field: 'dateTo', issue: 'range_too_large' }],
    });
  }
}
