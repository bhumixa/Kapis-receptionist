import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { TenantInvitationService } from '../../tenants/application/tenant-invitation.service';
import { AuthTenant } from '../domain/entities/auth-tenant.entity';
import { AuthUser } from '../domain/entities/auth-user.entity';
import {
  EMAIL_VERIFICATION_REPOSITORY,
  type EmailVerificationRepositoryPort,
} from '../domain/ports/email-verification-repository.port';
import {
  PASSWORD_RESET_REPOSITORY,
  type PasswordResetRepositoryPort,
} from '../domain/ports/password-reset-repository.port';
import {
  REGISTRATION_REPOSITORY,
  type RegistrationRepositoryPort,
} from '../domain/ports/registration-repository.port';
import {
  TENANT_REPOSITORY,
  type TenantRepositoryPort,
} from '../domain/ports/tenant-repository.port';
import {
  USER_REPOSITORY,
  type UserRepositoryPort,
} from '../domain/ports/user-repository.port';
import {
  AccountDeactivatedException,
  AccountLockedException,
  EmailAlreadyExistsException,
  EmailNotVerifiedException,
  InvalidCredentialsException,
  InvalidOrExpiredTokenException,
} from './exceptions/auth.exceptions';
import { LoginAttemptService } from './login-attempt.service';
import { PasswordService } from './password.service';
import { RequestMeta, SessionService } from './session.service';
import { SecurityEventService } from './security-event.service';
import { AccessTokenPayload, TokenService } from './token.service';

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantName: string;
  timezone: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthenticatedSession {
  user: AuthUser;
  tenant: AuthTenant | null;
  accessToken: string;
  expiresIn: number;
  rawRefreshToken: string;
}

export interface RefreshedSession {
  accessToken: string;
  expiresIn: number;
  rawRefreshToken: string;
}

/**
 * The Auth module's public application service — orchestrates
 * PasswordService/TokenService/SessionService/SecurityEventService/
 * LoginAttemptService/NotificationsService against the repository ports.
 * Controllers call only this; no business logic lives in
 * `interface/auth.controller.ts` (coding standards Section 12.5).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(REGISTRATION_REPOSITORY)
    private readonly registration: RegistrationRepositoryPort,
    @Inject(EMAIL_VERIFICATION_REPOSITORY)
    private readonly emailVerifications: EmailVerificationRepositoryPort,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResets: PasswordResetRepositoryPort,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly securityEvents: SecurityEventService,
    private readonly loginAttempts: LoginAttemptService,
    private readonly notifications: NotificationsService,
    private readonly configService: ConfigService,
    private readonly invitations: TenantInvitationService,
  ) {}

  async register(
    input: RegisterInput,
  ): Promise<{ user: AuthUser; tenant: AuthTenant }> {
    const email = normalizeEmail(input.email);

    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new EmailAlreadyExistsException();
    }

    const passwordHash = await this.passwords.hash(input.password);

    const result = await this.registration.registerTenantOwner({
      email,
      passwordHash,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      tenantName: input.tenantName.trim(),
      timezone: input.timezone,
    });

    this.securityEvents.record('REGISTER', {
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
    });

    await this.issueAndSendVerificationEmail(result.user);

    return result;
  }

  async login(
    input: LoginInput,
    meta: RequestMeta,
  ): Promise<AuthenticatedSession> {
    const email = normalizeEmail(input.email);

    const lockout = await this.loginAttempts.getLockoutStatus(email);
    if (lockout.locked) {
      this.securityEvents.record('LOGIN_BLOCKED_LOCKED_OUT', { email });
      throw new AccountLockedException(lockout.retryAfterSeconds);
    }

    const user = await this.users.findByEmail(email);

    if (!user || !user.passwordHash) {
      await this.loginAttempts.recordFailure(email);
      this.securityEvents.record('LOGIN_FAILURE', {
        email,
        reason: 'no_such_account',
      });
      throw new InvalidCredentialsException();
    }

    const passwordValid = await this.passwords.verify(
      user.passwordHash,
      input.password,
    );
    if (!passwordValid) {
      const result = await this.loginAttempts.recordFailure(email);
      if (result.locked) {
        this.securityEvents.record('ACCOUNT_LOCKED', {
          userId: user.id,
          email,
        });
      }
      this.securityEvents.record('LOGIN_FAILURE', {
        userId: user.id,
        email,
        reason: 'bad_password',
      });
      throw new InvalidCredentialsException();
    }

    if (!user.isActive) {
      throw new AccountDeactivatedException();
    }

    if (!user.isEmailVerified) {
      throw new EmailNotVerifiedException();
    }

    await this.loginAttempts.recordSuccess(email);
    await this.users.updateLastLoginAt(user.id, new Date());

    const tenant = user.tenantId
      ? await this.tenants.findById(user.tenantId)
      : null;

    const { accessToken, expiresIn } = this.tokens.signAccessToken(
      toAccessTokenPayload(user),
    );
    const session = await this.sessions.issueSession(user.id, meta);

    this.securityEvents.record('LOGIN_SUCCESS', {
      userId: user.id,
      tenantId: user.tenantId,
    });

    return {
      user: { ...user, lastLoginAt: new Date() },
      tenant,
      accessToken,
      expiresIn,
      rawRefreshToken: session.rawRefreshToken,
    };
  }

  async refresh(
    rawRefreshToken: string,
    meta: RequestMeta,
  ): Promise<RefreshedSession> {
    const rotated = await this.sessions.rotate(rawRefreshToken, meta);
    const user = await this.users.findById(rotated.userId);

    if (!user) {
      // The session outlived its user (shouldn't happen — RefreshToken
      // cascades on User delete — but never trust a stale token blindly).
      throw new UnauthorizedException();
    }

    const { accessToken, expiresIn } = this.tokens.signAccessToken(
      toAccessTokenPayload(user),
    );

    this.securityEvents.record('REFRESH_SUCCESS', { userId: user.id });

    return { accessToken, expiresIn, rawRefreshToken: rotated.rawRefreshToken };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.sessions.revoke(rawRefreshToken);
  }

  /**
   * `effectiveTenantId` (Milestone 3, docs/adr/ADR-006): the caller's
   * *resolved* tenant context (via `TenantContextService`, honoring Super
   * Admin impersonation), not necessarily the same as `user.tenantId` from
   * the JWT — so the frontend always knows which tenant is actually in
   * effect, distinct from the JWT's own home-tenant claim. Resolved by the
   * controller (which owns `TenantContextService`, a request-scoped
   * provider) and passed in here, keeping this service a plain singleton.
   */
  async me(
    userId: string,
    effectiveTenantId: string | null,
  ): Promise<{
    user: AuthUser;
    tenant: AuthTenant | null;
    activeTenantId: string | null;
  }> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    const tenant = effectiveTenantId
      ? await this.tenants.findById(effectiveTenantId)
      : null;

    return { user, tenant, activeTenantId: effectiveTenantId };
  }

  /**
   * `POST /auth/accept-invitation` (Milestone 3, docs/adr/ADR-006) — closes
   * the staff-onboarding loop `TenantInvitationService.createInvitation`
   * opens. Validates the token, creates the invited `User`+`UserRole` for
   * the invitation's tenant, marks the invitation accepted, and establishes
   * a session identically to `login` — the invitee lands signed in, not
   * redirected to a separate login step.
   */
  async acceptInvitation(
    input: {
      token: string;
      firstName: string;
      lastName: string;
      password: string;
    },
    meta: RequestMeta,
  ): Promise<AuthenticatedSession> {
    const consumed = await this.invitations.validateAndConsume(input.token);

    const existing = await this.users.findByEmail(
      normalizeEmail(consumed.email),
    );
    if (existing) {
      throw new EmailAlreadyExistsException();
    }

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.registration.registerInvitedUser({
      tenantId: consumed.tenantId,
      email: consumed.email,
      passwordHash,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      roleId: consumed.roleId,
    });

    await this.invitations.markAccepted(
      consumed.invitationId,
      consumed.tenantId,
      user.id,
    );

    this.securityEvents.record('REGISTER', {
      userId: user.id,
      tenantId: consumed.tenantId,
      email: user.email,
    });

    const tenant = await this.tenants.findById(consumed.tenantId);
    const { accessToken, expiresIn } = this.tokens.signAccessToken(
      toAccessTokenPayload(user),
    );
    const session = await this.sessions.issueSession(user.id, meta);

    return {
      user,
      tenant,
      accessToken,
      expiresIn,
      rawRefreshToken: session.rawRefreshToken,
    };
  }

  /**
   * Enumeration-safe by design (API_SPECIFICATION.md Section 4's
   * `/auth/forgot-password` non-enumeration precedent, applied identically
   * here): callers never learn whether the email exists or is already
   * verified from this method's (lack of a) return value.
   */
  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(normalizeEmail(email));
    if (user && !user.isEmailVerified) {
      await this.issueAndSendVerificationEmail(user);
    }
  }

  async verifyEmail(rawToken: string): Promise<{ user: AuthUser }> {
    const tokenHash = this.tokens.hashOpaqueToken(rawToken);
    const record = await this.emailVerifications.findByHash(tokenHash);

    if (
      !record ||
      record.verifiedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new InvalidOrExpiredTokenException();
    }

    await this.emailVerifications.markVerified(record.id);
    await this.users.markEmailVerified(record.userId);

    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    this.securityEvents.record('EMAIL_VERIFIED', { userId: user.id });

    return { user: { ...user, isEmailVerified: true } };
  }

  /** Enumeration-safe (same rationale as `resendVerification`). */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(normalizeEmail(email));
    if (user) {
      await this.issueAndSendPasswordResetEmail(user);
    }
  }

  /**
   * Validates the reset token, updates the password, and — per this
   * sprint's explicit requirement — revokes every refresh token for the
   * user (SYSTEM_ARCHITECTURE.md Section 7.6: "all active sessions/refresh
   * tokens... invalidated on successful password reset").
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.tokens.hashOpaqueToken(rawToken);
    const record = await this.passwordResets.findByHash(tokenHash);

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new InvalidOrExpiredTokenException();
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.users.updatePassword(record.userId, passwordHash);
    await this.passwordResets.markUsed(record.id);
    await this.sessions.revokeAllForUser(record.userId);

    this.securityEvents.record('PASSWORD_RESET_SUCCESS', {
      userId: record.userId,
    });
  }

  private async issueAndSendVerificationEmail(user: AuthUser): Promise<void> {
    await this.emailVerifications.invalidateActiveForUser(user.id);

    const rawToken = this.tokens.generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() +
        this.configService.getOrThrow<number>(
          'accountSecurity.emailVerificationExpiresInSeconds',
        ) *
          1000,
    );
    await this.emailVerifications.create({
      userId: user.id,
      tokenHash: this.tokens.hashOpaqueToken(rawToken),
      expiresAt,
    });

    const verifyUrl = `${this.configService.getOrThrow<string>('mail.frontendUrl')}/auth/verify-email/${rawToken}`;
    await this.notifications.sendEmail({
      to: user.email,
      subject: 'Verify your email address',
      html: `<p>Welcome to Kapis Receptionist. Please verify your email address by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
      text: `Verify your email address: ${verifyUrl} (expires in 24 hours)`,
    });

    this.securityEvents.record('EMAIL_VERIFICATION_SENT', {
      userId: user.id,
      email: user.email,
    });
  }

  private async issueAndSendPasswordResetEmail(user: AuthUser): Promise<void> {
    await this.passwordResets.invalidateActiveForUser(user.id);

    const rawToken = this.tokens.generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() +
        this.configService.getOrThrow<number>(
          'accountSecurity.passwordResetExpiresInSeconds',
        ) *
          1000,
    );
    await this.passwordResets.create({
      userId: user.id,
      tokenHash: this.tokens.hashOpaqueToken(rawToken),
      expiresAt,
    });

    const resetUrl = `${this.configService.getOrThrow<string>('mail.frontendUrl')}/auth/reset-password/${rawToken}`;
    await this.notifications.sendEmail({
      to: user.email,
      subject: 'Reset your password',
      html: `<p>We received a request to reset your password. Click the link below to choose a new one:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
      text: `Reset your password: ${resetUrl} (expires in 1 hour). If you didn't request this, ignore this email.`,
    });

    this.securityEvents.record('PASSWORD_RESET_REQUESTED', {
      userId: user.id,
      email: user.email,
    });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAccessTokenPayload(user: AuthUser): AccessTokenPayload {
  return {
    sub: user.id,
    email: user.email,
    tenantId: user.tenantId,
    roles: user.roles,
  };
}
