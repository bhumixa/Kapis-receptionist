import { UnauthorizedException } from '@nestjs/common';
import { RoleName, TenantStatus } from '@prisma/client';
import { AuthService } from '../../../src/modules/auth/application/auth.service';
import {
  AccountDeactivatedException,
  AccountLockedException,
  EmailAlreadyExistsException,
  EmailNotVerifiedException,
  InvalidCredentialsException,
  InvalidOrExpiredTokenException,
} from '../../../src/modules/auth/application/exceptions/auth.exceptions';
import { LoginAttemptService } from '../../../src/modules/auth/application/login-attempt.service';
import { PasswordService } from '../../../src/modules/auth/application/password.service';
import { SecurityEventService } from '../../../src/modules/auth/application/security-event.service';
import { SessionService } from '../../../src/modules/auth/application/session.service';
import { TokenService } from '../../../src/modules/auth/application/token.service';
import { AuthTenant } from '../../../src/modules/auth/domain/entities/auth-tenant.entity';
import { AuthUser } from '../../../src/modules/auth/domain/entities/auth-user.entity';
import { EmailVerificationRepositoryPort } from '../../../src/modules/auth/domain/ports/email-verification-repository.port';
import { PasswordResetRepositoryPort } from '../../../src/modules/auth/domain/ports/password-reset-repository.port';
import { RegistrationRepositoryPort } from '../../../src/modules/auth/domain/ports/registration-repository.port';
import { TenantRepositoryPort } from '../../../src/modules/auth/domain/ports/tenant-repository.port';
import { UserRepositoryPort } from '../../../src/modules/auth/domain/ports/user-repository.port';
import { NotificationsService } from '../../../src/modules/notifications/application/notifications.service';

const meta = { userAgent: 'jest', ipAddress: '127.0.0.1' };

const CONFIG_VALUES: Record<string, unknown> = {
  'accountSecurity.emailVerificationExpiresInSeconds': 86400,
  'accountSecurity.passwordResetExpiresInSeconds': 3600,
  'mail.frontendUrl': 'http://localhost:4200',
};

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'owner@salon.com',
    passwordHash: 'hashed',
    firstName: 'Maria',
    lastName: 'Gomez',
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    roles: [RoleName.OWNER],
    ...overrides,
  };
}

function makeTenant(overrides: Partial<AuthTenant> = {}): AuthTenant {
  return {
    id: 'tenant-1',
    name: 'Bella Salon',
    slug: 'bella-salon',
    status: TenantStatus.TRIAL,
    timezone: 'UTC',
    addressLine1: null,
    city: null,
    countryCode: null,
    defaultLocale: 'en',
    trialEndsAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AuthService', () => {
  let users: jest.Mocked<UserRepositoryPort>;
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let registration: jest.Mocked<RegistrationRepositoryPort>;
  let emailVerifications: jest.Mocked<EmailVerificationRepositoryPort>;
  let passwordResets: jest.Mocked<PasswordResetRepositoryPort>;
  let passwords: jest.Mocked<Pick<PasswordService, 'hash' | 'verify'>>;
  let tokens: jest.Mocked<
    Pick<
      TokenService,
      'signAccessToken' | 'generateOpaqueToken' | 'hashOpaqueToken'
    >
  >;
  let sessions: jest.Mocked<
    Pick<
      SessionService,
      'issueSession' | 'rotate' | 'revoke' | 'revokeAllForUser'
    >
  >;
  let securityEvents: jest.Mocked<Pick<SecurityEventService, 'record'>>;
  let loginAttempts: jest.Mocked<
    Pick<
      LoginAttemptService,
      'getLockoutStatus' | 'recordFailure' | 'recordSuccess'
    >
  >;
  let notifications: jest.Mocked<Pick<NotificationsService, 'sendEmail'>>;
  let configService: { getOrThrow: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updateLastLoginAt: jest.fn(),
      markEmailVerified: jest.fn(),
      updatePassword: jest.fn(),
    };
    tenants = { findById: jest.fn() };
    registration = { registerTenantOwner: jest.fn() };
    emailVerifications = {
      create: jest.fn(),
      findByHash: jest.fn(),
      markVerified: jest.fn(),
      invalidateActiveForUser: jest.fn(),
    };
    passwordResets = {
      create: jest.fn(),
      findByHash: jest.fn(),
      markUsed: jest.fn(),
      invalidateActiveForUser: jest.fn(),
    };
    passwords = { hash: jest.fn(), verify: jest.fn() };
    tokens = {
      signAccessToken: jest.fn(),
      generateOpaqueToken: jest.fn().mockReturnValue('raw-opaque-token'),
      hashOpaqueToken: jest.fn().mockReturnValue('hashed-opaque-token'),
    };
    sessions = {
      issueSession: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    securityEvents = { record: jest.fn() };
    loginAttempts = {
      getLockoutStatus: jest
        .fn()
        .mockResolvedValue({ locked: false, retryAfterSeconds: 0 }),
      recordFailure: jest
        .fn()
        .mockResolvedValue({ locked: false, retryAfterSeconds: 0 }),
      recordSuccess: jest.fn(),
    };
    notifications = { sendEmail: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => CONFIG_VALUES[key]),
    };

    service = new AuthService(
      users,
      tenants,
      registration,
      emailVerifications,
      passwordResets,
      passwords,
      tokens as unknown as TokenService,
      sessions as unknown as SessionService,
      securityEvents as unknown as SecurityEventService,
      loginAttempts as unknown as LoginAttemptService,
      notifications as unknown as NotificationsService,
      configService as unknown as ConstructorParameters<typeof AuthService>[11],
    );
  });

  describe('register', () => {
    it('normalizes the email, hashes the password, delegates to the registration port, and sends a verification email', async () => {
      users.findByEmail.mockResolvedValue(null);
      passwords.hash.mockResolvedValue('argon2-hash');
      registration.registerTenantOwner.mockResolvedValue({
        user: makeUser(),
        tenant: makeTenant(),
      });

      const result = await service.register({
        email: '  Owner@Salon.com  ',
        password: 'Str0ngP@ss!',
        firstName: ' Maria ',
        lastName: ' Gomez ',
        tenantName: ' Bella Salon ',
        timezone: 'UTC',
      });

      expect(users.findByEmail).toHaveBeenCalledWith('owner@salon.com');
      expect(passwords.hash).toHaveBeenCalledWith('Str0ngP@ss!');
      expect(registration.registerTenantOwner).toHaveBeenCalledWith({
        email: 'owner@salon.com',
        passwordHash: 'argon2-hash',
        firstName: 'Maria',
        lastName: 'Gomez',
        tenantName: 'Bella Salon',
        timezone: 'UTC',
      });
      expect(securityEvents.record).toHaveBeenCalledWith(
        'REGISTER',
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(emailVerifications.invalidateActiveForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(emailVerifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@salon.com' }),
      );
      expect(securityEvents.record).toHaveBeenCalledWith(
        'EMAIL_VERIFICATION_SENT',
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(result.user.id).toBe('user-1');
    });

    it('rejects registration when the email is already taken, without hashing the password', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await expect(
        service.register({
          email: 'owner@salon.com',
          password: 'Str0ngP@ss!',
          firstName: 'Maria',
          lastName: 'Gomez',
          tenantName: 'Bella Salon',
          timezone: 'UTC',
        }),
      ).rejects.toBeInstanceOf(EmailAlreadyExistsException);

      expect(passwords.hash).not.toHaveBeenCalled();
      expect(registration.registerTenantOwner).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues an access token and a session on valid credentials', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(true);
      tenants.findById.mockResolvedValue(makeTenant());
      tokens.signAccessToken.mockReturnValue({
        accessToken: 'jwt',
        expiresIn: 900,
      });
      sessions.issueSession.mockResolvedValue({
        id: 'token-1',
        rawRefreshToken: 'raw-refresh',
        expiresAt: new Date(),
      });

      const result = await service.login(
        { email: 'owner@salon.com', password: 'Str0ngP@ss!' },
        meta,
      );

      expect(loginAttempts.getLockoutStatus).toHaveBeenCalledWith(
        'owner@salon.com',
      );
      expect(loginAttempts.recordSuccess).toHaveBeenCalledWith(
        'owner@salon.com',
      );
      expect(users.updateLastLoginAt).toHaveBeenCalledWith(
        'user-1',
        expect.any(Date),
      );
      expect(result.accessToken).toBe('jwt');
      expect(result.rawRefreshToken).toBe('raw-refresh');
      expect(securityEvents.record).toHaveBeenCalledWith(
        'LOGIN_SUCCESS',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('rejects when the account is currently locked out, without looking up the user', async () => {
      loginAttempts.getLockoutStatus.mockResolvedValue({
        locked: true,
        retryAfterSeconds: 300,
      });

      await expect(
        service.login({ email: 'owner@salon.com', password: 'x' }, meta),
      ).rejects.toBeInstanceOf(AccountLockedException);
      expect(users.findByEmail).not.toHaveBeenCalled();
      expect(securityEvents.record).toHaveBeenCalledWith(
        'LOGIN_BLOCKED_LOCKED_OUT',
        expect.objectContaining({ email: 'owner@salon.com' }),
      );
    });

    it('rejects a login for an email that does not exist without a distinguishing error, and records a failed attempt', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@salon.com', password: 'x' }, meta),
      ).rejects.toBeInstanceOf(InvalidCredentialsException);
      expect(loginAttempts.recordFailure).toHaveBeenCalledWith(
        'nobody@salon.com',
      );
      expect(securityEvents.record).toHaveBeenCalledWith(
        'LOGIN_FAILURE',
        expect.objectContaining({ reason: 'no_such_account' }),
      );
    });

    it('rejects a login with the wrong password using the same error as an unknown account, and records a failed attempt', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'owner@salon.com', password: 'wrong' }, meta),
      ).rejects.toBeInstanceOf(InvalidCredentialsException);
      expect(loginAttempts.recordFailure).toHaveBeenCalledWith(
        'owner@salon.com',
      );
      expect(securityEvents.record).toHaveBeenCalledWith(
        'LOGIN_FAILURE',
        expect.objectContaining({ reason: 'bad_password' }),
      );
    });

    it('logs an ACCOUNT_LOCKED security event when a failed attempt crosses the lockout threshold', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(false);
      loginAttempts.recordFailure.mockResolvedValue({
        locked: true,
        retryAfterSeconds: 900,
      });

      await expect(
        service.login({ email: 'owner@salon.com', password: 'wrong' }, meta),
      ).rejects.toBeInstanceOf(InvalidCredentialsException);
      expect(securityEvents.record).toHaveBeenCalledWith(
        'ACCOUNT_LOCKED',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('rejects a login for a deactivated account after password verification', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ isActive: false }));
      passwords.verify.mockResolvedValue(true);

      await expect(
        service.login(
          { email: 'owner@salon.com', password: 'Str0ngP@ss!' },
          meta,
        ),
      ).rejects.toBeInstanceOf(AccountDeactivatedException);
      expect(sessions.issueSession).not.toHaveBeenCalled();
    });

    it('rejects a login for an unverified email after password verification, without recording a failed attempt', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ isEmailVerified: false }));
      passwords.verify.mockResolvedValue(true);

      await expect(
        service.login(
          { email: 'owner@salon.com', password: 'Str0ngP@ss!' },
          meta,
        ),
      ).rejects.toBeInstanceOf(EmailNotVerifiedException);
      expect(sessions.issueSession).not.toHaveBeenCalled();
      expect(loginAttempts.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates the session and signs a fresh access token for the session owner', async () => {
      sessions.rotate.mockResolvedValue({
        id: 'token-2',
        userId: 'user-1',
        rawRefreshToken: 'new-raw',
        expiresAt: new Date(),
      });
      users.findById.mockResolvedValue(makeUser());
      tokens.signAccessToken.mockReturnValue({
        accessToken: 'jwt-2',
        expiresIn: 900,
      });

      const result = await service.refresh('old-raw', meta);

      expect(sessions.rotate).toHaveBeenCalledWith('old-raw', meta);
      expect(result).toEqual({
        accessToken: 'jwt-2',
        expiresIn: 900,
        rawRefreshToken: 'new-raw',
      });
    });

    it('rejects if the session belongs to a user that no longer exists', async () => {
      sessions.rotate.mockResolvedValue({
        id: 'token-2',
        userId: 'ghost',
        rawRefreshToken: 'new-raw',
        expiresAt: new Date(),
      });
      users.findById.mockResolvedValue(null);

      await expect(service.refresh('old-raw', meta)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('delegates to SessionService.revoke', async () => {
      await service.logout('raw-token');
      expect(sessions.revoke).toHaveBeenCalledWith('raw-token');
    });
  });

  describe('me', () => {
    it('returns the user and their tenant', async () => {
      users.findById.mockResolvedValue(makeUser());
      tenants.findById.mockResolvedValue(makeTenant());

      const result = await service.me('user-1');
      expect(result.user.id).toBe('user-1');
      expect(result.tenant?.id).toBe('tenant-1');
    });

    it('rejects if the authenticated user id no longer resolves to a user', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.me('ghost')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('resendVerification', () => {
    it('sends a new verification email when the account exists and is unverified', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ isEmailVerified: false }));

      await service.resendVerification('Owner@Salon.com');

      expect(users.findByEmail).toHaveBeenCalledWith('owner@salon.com');
      expect(notifications.sendEmail).toHaveBeenCalled();
    });

    it('does nothing (no email sent) when the account is already verified', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ isEmailVerified: true }));

      await service.resendVerification('owner@salon.com');

      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('does nothing (no error, no email) when the account does not exist — enumeration-safe', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.resendVerification('nobody@salon.com'),
      ).resolves.toBeUndefined();
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('marks the token and user verified for a valid, unexpired, unused token', async () => {
      tokens.hashOpaqueToken.mockReturnValue('hashed-opaque-token');
      emailVerifications.findByHash.mockResolvedValue({
        id: 'ev-1',
        userId: 'user-1',
        tokenHash: 'hashed-opaque-token',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        verifiedAt: null,
        createdAt: new Date(),
      });
      users.findById.mockResolvedValue(makeUser({ isEmailVerified: false }));

      const result = await service.verifyEmail('raw-token');

      expect(emailVerifications.markVerified).toHaveBeenCalledWith('ev-1');
      expect(users.markEmailVerified).toHaveBeenCalledWith('user-1');
      expect(result.user.isEmailVerified).toBe(true);
      expect(securityEvents.record).toHaveBeenCalledWith(
        'EMAIL_VERIFIED',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('rejects an unknown token', async () => {
      emailVerifications.findByHash.mockResolvedValue(null);

      await expect(service.verifyEmail('bad-token')).rejects.toBeInstanceOf(
        InvalidOrExpiredTokenException,
      );
    });

    it('rejects an already-verified token', async () => {
      emailVerifications.findByHash.mockResolvedValue({
        id: 'ev-1',
        userId: 'user-1',
        tokenHash: 'hashed-opaque-token',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        verifiedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(service.verifyEmail('raw-token')).rejects.toBeInstanceOf(
        InvalidOrExpiredTokenException,
      );
    });

    it('rejects an expired token', async () => {
      emailVerifications.findByHash.mockResolvedValue({
        id: 'ev-1',
        userId: 'user-1',
        tokenHash: 'hashed-opaque-token',
        expiresAt: new Date(Date.now() - 1000),
        verifiedAt: null,
        createdAt: new Date(),
      });

      await expect(service.verifyEmail('raw-token')).rejects.toBeInstanceOf(
        InvalidOrExpiredTokenException,
      );
    });
  });

  describe('forgotPassword', () => {
    it('issues and sends a reset email when the account exists', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await service.forgotPassword('owner@salon.com');

      expect(passwordResets.invalidateActiveForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(passwordResets.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(notifications.sendEmail).toHaveBeenCalled();
      expect(securityEvents.record).toHaveBeenCalledWith(
        'PASSWORD_RESET_REQUESTED',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('does nothing (no error, no email) when the account does not exist — enumeration-safe', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.forgotPassword('nobody@salon.com'),
      ).resolves.toBeUndefined();
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password and revokes every refresh token for the user', async () => {
      passwordResets.findByHash.mockResolvedValue({
        id: 'pr-1',
        userId: 'user-1',
        tokenHash: 'hashed-opaque-token',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        usedAt: null,
        createdAt: new Date(),
      });
      passwords.hash.mockResolvedValue('new-argon2-hash');

      await service.resetPassword('raw-token', 'N3wStr0ngP@ss!');

      expect(passwords.hash).toHaveBeenCalledWith('N3wStr0ngP@ss!');
      expect(users.updatePassword).toHaveBeenCalledWith(
        'user-1',
        'new-argon2-hash',
      );
      expect(passwordResets.markUsed).toHaveBeenCalledWith('pr-1');
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(securityEvents.record).toHaveBeenCalledWith(
        'PASSWORD_RESET_SUCCESS',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('rejects an unknown token without touching the password or sessions', async () => {
      passwordResets.findByHash.mockResolvedValue(null);

      await expect(
        service.resetPassword('bad-token', 'N3wStr0ngP@ss!'),
      ).rejects.toBeInstanceOf(InvalidOrExpiredTokenException);
      expect(users.updatePassword).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects an already-used token', async () => {
      passwordResets.findByHash.mockResolvedValue({
        id: 'pr-1',
        userId: 'user-1',
        tokenHash: 'hashed-opaque-token',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        usedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(
        service.resetPassword('raw-token', 'N3wStr0ngP@ss!'),
      ).rejects.toBeInstanceOf(InvalidOrExpiredTokenException);
    });

    it('rejects an expired token', async () => {
      passwordResets.findByHash.mockResolvedValue({
        id: 'pr-1',
        userId: 'user-1',
        tokenHash: 'hashed-opaque-token',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        createdAt: new Date(),
      });

      await expect(
        service.resetPassword('raw-token', 'N3wStr0ngP@ss!'),
      ).rejects.toBeInstanceOf(InvalidOrExpiredTokenException);
    });
  });
});
