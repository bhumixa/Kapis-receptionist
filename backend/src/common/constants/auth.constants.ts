/**
 * Argon2id production parameters (docs/AUTHENTICATION.md "Password Hashing"
 * section has the full rationale). Above OWASP's stated minimum (19 MiB /
 * t=2 / p=1) — justified given this runs on a dedicated multi-core VPS and
 * register/login are low-frequency-per-user operations, so the extra cost
 * is imperceptible to UX but meaningfully raises offline-cracking cost.
 */
export const ARGON2ID_OPTIONS = {
  memoryCost: 65536, // 64 MiB, in KiB (argon2 npm package's unit)
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
} as const;

/** API_SPECIFICATION.md Section 4 validation rules for `password`. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * httpOnly refresh-token cookie (SYSTEM_ARCHITECTURE.md Section 7.2).
 * Scoped to the auth path only — least-privilege: no reason for this
 * cookie to be sent on every other API request.
 */
export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
export const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth';

/** API_SPECIFICATION.md Section 2.10 rate-limit tiers, this module's subset. */
export const THROTTLE_PUBLIC_SENSITIVE = 'public-sensitive';
export const THROTTLE_STANDARD_AUTHENTICATED = 'standard-authenticated';

export const AUTH_ERROR_CODES = {
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  INVALID_OR_EXPIRED_REFRESH_TOKEN: 'INVALID_OR_EXPIRED_REFRESH_TOKEN',
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',
  // Sprint 2.3 — Account Security (docs/AUTHENTICATION.md)
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_OR_EXPIRED_TOKEN: 'INVALID_OR_EXPIRED_TOKEN',
} as const;
