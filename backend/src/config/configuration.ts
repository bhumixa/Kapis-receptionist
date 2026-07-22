import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  name: process.env.APP_NAME,
  corsOrigin: process.env.CORS_ORIGIN,
  logLevel: process.env.LOG_LEVEL ?? 'info',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL,
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET,
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  accessExpiresInSeconds: parseInt(
    process.env.JWT_ACCESS_EXPIRES_IN_SECONDS ?? '900',
    10,
  ),
  // Not used to sign a JWT — see TokenService/SessionService: this peppers
  // the HMAC used to hash the opaque refresh token before storage, keeping
  // it a genuinely separate secret from the access-token signing key even
  // though the refresh token itself is never a JWT.
  refreshPepper: process.env.JWT_REFRESH_SECRET,
  refreshExpiresInSeconds: parseInt(
    process.env.JWT_REFRESH_EXPIRES_IN_SECONDS ?? `${60 * 60 * 24 * 30}`,
    10,
  ),
}));

/**
 * Minimal SMTP transport for the Notifications module (SYSTEM_ARCHITECTURE.md
 * Section 3.2's `Notifications` module, pulled forward from Milestone 9's
 * full build-out to the single `sendEmail` capability this sprint's
 * verification/reset flows need). If `SMTP_HOST` is unset, `NotificationsService`
 * logs the email instead of sending it — keeps local/CI environments working
 * with zero mail infrastructure.
 */
export const mailConfig = registerAs('mail', () => ({
  smtpHost: process.env.SMTP_HOST || null,
  smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
  smtpUser: process.env.SMTP_USER || null,
  smtpPass: process.env.SMTP_PASS || null,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  fromAddress:
    process.env.MAIL_FROM ?? 'no-reply@kapis-receptionist.example.com',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:4200',
}));

/**
 * Login-attempt tracking / temporary lockout (docs/AUTHENTICATION.md's
 * Sprint 2.3 "Account Security" addition) — Redis-backed, ephemeral by
 * design (DATABASE_DESIGN.md Section 1.6), keyed by normalized email so
 * lockout behavior itself never distinguishes an existing account from a
 * nonexistent one.
 */
export const loginSecurityConfig = registerAs('loginSecurity', () => ({
  maxAttempts: parseInt(process.env.LOGIN_ATTEMPT_MAX ?? '5', 10),
  attemptWindowSeconds: parseInt(
    process.env.LOGIN_ATTEMPT_WINDOW_SECONDS ?? '900',
    10,
  ),
  lockoutSeconds: parseInt(process.env.LOGIN_LOCKOUT_SECONDS ?? '900', 10),
}));

/** Email verification / password reset token lifetimes. */
export const accountSecurityConfig = registerAs('accountSecurity', () => ({
  emailVerificationExpiresInSeconds: parseInt(
    process.env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS ?? `${60 * 60 * 24}`,
    10,
  ),
  passwordResetExpiresInSeconds: parseInt(
    process.env.PASSWORD_RESET_EXPIRES_IN_SECONDS ?? `${60 * 60}`,
    10,
  ),
}));

/**
 * Authorization / RBAC (Sprint 2.4, docs/adr/ADR-005-rbac.md).
 * `PermissionResolverService` caches each role's resolved permission set in
 * Redis for this long — TTL-only invalidation this sprint (no runtime
 * `RolePermission` mutation endpoint exists yet to actively invalidate
 * against; see the ADR for the documented tradeoff).
 */
export const rbacConfig = registerAs('rbac', () => ({
  permissionCacheTtlSeconds: parseInt(
    process.env.RBAC_PERMISSION_CACHE_TTL_SECONDS ?? '3600',
    10,
  ),
}));

/** Tenant invitations (Milestone 3, docs/TENANT_ARCHITECTURE.md). */
export const tenantsConfig = registerAs('tenants', () => ({
  invitationExpiresInSeconds: parseInt(
    process.env.TENANT_INVITATION_EXPIRES_IN_SECONDS ?? `${60 * 60 * 24 * 7}`,
    10,
  ),
}));
