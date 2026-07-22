import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';

export const TENANT_ERROR_CODES = {
  INVALID_LIFECYCLE_TRANSITION: 'INVALID_LIFECYCLE_TRANSITION',
  INVITATION_ALREADY_PENDING: 'INVITATION_ALREADY_PENDING',
  INVALID_OR_EXPIRED_INVITATION: 'INVALID_OR_EXPIRED_INVITATION',
} as const;

export class InvalidTenantLifecycleTransitionException extends ConflictException {
  constructor(from: TenantStatus, to: TenantStatus) {
    super({
      code: TENANT_ERROR_CODES.INVALID_LIFECYCLE_TRANSITION,
      message: `Cannot transition a tenant from ${from} to ${to}.`,
      details: [{ from, to }],
    });
  }
}

export class InvitationAlreadyPendingException extends ConflictException {
  constructor() {
    super({
      code: TENANT_ERROR_CODES.INVITATION_ALREADY_PENDING,
      message: 'A pending invitation already exists for this email.',
      details: [],
    });
  }
}

/** `400`, not `404` — the token itself is the credential, same convention as `InvalidOrExpiredTokenException` (Auth module). */
export class InvalidOrExpiredInvitationException extends HttpException {
  constructor() {
    super(
      {
        code: TENANT_ERROR_CODES.INVALID_OR_EXPIRED_INVITATION,
        message: 'This invitation link is invalid or has expired.',
        details: [],
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
