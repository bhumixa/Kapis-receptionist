import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AUTH_ERROR_CODES } from '../../../../common/constants/auth.constants';

/**
 * Typed, named business-rule exceptions (coding standards Section 12.8) —
 * the global exception filter maps these to API_SPECIFICATION.md Section
 * 4's documented error codes automatically via their structured body,
 * without any controller-level try/catch.
 */

export class EmailAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      code: AUTH_ERROR_CODES.EMAIL_ALREADY_EXISTS,
      message: 'An account with this email already exists.',
      details: [],
    });
  }
}

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({
      code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
      message: 'Incorrect email or password.',
      details: [],
    });
  }
}

export class AccountDeactivatedException extends UnauthorizedException {
  constructor() {
    super({
      code: AUTH_ERROR_CODES.ACCOUNT_DEACTIVATED,
      message: 'This account has been deactivated.',
      details: [],
    });
  }
}

export class InvalidRefreshTokenException extends UnauthorizedException {
  constructor() {
    super({
      code: AUTH_ERROR_CODES.INVALID_OR_EXPIRED_REFRESH_TOKEN,
      message: 'Session is invalid or has expired. Please log in again.',
      details: [],
    });
  }
}

export class RefreshTokenReuseDetectedException extends UnauthorizedException {
  constructor() {
    super({
      code: AUTH_ERROR_CODES.REFRESH_TOKEN_REUSE_DETECTED,
      message:
        'A security issue was detected with this session. All sessions have been signed out — please log in again.',
      details: [],
    });
  }
}

export class EmailNotVerifiedException extends ForbiddenException {
  constructor() {
    super({
      code: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
      message: 'Please verify your email address before logging in.',
      details: [],
    });
  }
}

export class AccountLockedException extends ForbiddenException {
  constructor(retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super({
      code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
      message: `Too many failed login attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      details: [{ field: 'account', issue: 'locked', retryAfterSeconds }],
    });
  }
}

export class InvalidOrExpiredTokenException extends BadRequestException {
  constructor() {
    super({
      code: AUTH_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      message: 'This link is invalid or has expired.',
      details: [],
    });
  }
}
