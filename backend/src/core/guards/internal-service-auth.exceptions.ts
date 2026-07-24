import { BadRequestException, UnauthorizedException } from '@nestjs/common';

/**
 * Same "typed, named business-rule exceptions" convention as
 * `rbac.exceptions.ts` — the global exception filter maps these to
 * API_SPECIFICATION.md Section 2.3's envelope automatically.
 */

export class InvalidInternalCredentialException extends UnauthorizedException {
  constructor() {
    super({
      code: 'INVALID_INTERNAL_CREDENTIAL',
      message: 'A valid internal service credential is required.',
      details: [],
    });
  }
}

/**
 * An internal-service-authenticated request carries no JWT, so — unlike
 * every other request path in this system — tenant cannot be read from a
 * token claim. It must be supplied explicitly via `X-Tenant-Id`, mirroring
 * the existing header-based-context precedent `X-Impersonate-Tenant-Id`
 * already established (`core/middleware/tenant.middleware.ts`).
 */
export class MissingInternalTenantException extends BadRequestException {
  constructor() {
    super({
      code: 'INTERNAL_TENANT_ID_REQUIRED',
      message:
        'An X-Tenant-Id header is required for internal service requests.',
      details: [],
    });
  }
}
