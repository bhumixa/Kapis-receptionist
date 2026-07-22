import { UnauthorizedException } from '@nestjs/common';
import { RoleName, TenantStatus } from '@prisma/client';
import { AuthService } from '../../../src/modules/auth/application/auth.service';
import {
  AccountDeactivatedException,
  EmailAlreadyExistsException,
  InvalidCredentialsException,
} from '../../../src/modules/auth/application/exceptions/auth.exceptions';
import { PasswordService } from '../../../src/modules/auth/application/password.service';
import { SecurityEventService } from '../../../src/modules/auth/application/security-event.service';
import { SessionService } from '../../../src/modules/auth/application/session.service';
import { TokenService } from '../../../src/modules/auth/application/token.service';
import { AuthTenant } from '../../../src/modules/auth/domain/entities/auth-tenant.entity';
import { AuthUser } from '../../../src/modules/auth/domain/entities/auth-user.entity';
import { RegistrationRepositoryPort } from '../../../src/modules/auth/domain/ports/registration-repository.port';
import { TenantRepositoryPort } from '../../../src/modules/auth/domain/ports/tenant-repository.port';
import { UserRepositoryPort } from '../../../src/modules/auth/domain/ports/user-repository.port';

const meta = { userAgent: 'jest', ipAddress: '127.0.0.1' };

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'owner@salon.com',
    passwordHash: 'hashed',
    firstName: 'Maria',
    lastName: 'Gomez',
    isActive: true,
    isEmailVerified: false,
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
  let passwords: jest.Mocked<Pick<PasswordService, 'hash' | 'verify'>>;
  let tokens: jest.Mocked<Pick<TokenService, 'signAccessToken'>>;
  let sessions: jest.Mocked<
    Pick<SessionService, 'issueSession' | 'rotate' | 'revoke'>
  >;
  let securityEvents: jest.Mocked<Pick<SecurityEventService, 'record'>>;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updateLastLoginAt: jest.fn(),
    };
    tenants = { findById: jest.fn() };
    registration = { registerTenantOwner: jest.fn() };
    passwords = { hash: jest.fn(), verify: jest.fn() };
    tokens = { signAccessToken: jest.fn() };
    sessions = {
      issueSession: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
    };
    securityEvents = { record: jest.fn() };

    service = new AuthService(
      users,
      tenants,
      registration,
      passwords,
      tokens as unknown as TokenService,
      sessions as unknown as SessionService,
      securityEvents as unknown as SecurityEventService,
    );
  });

  describe('register', () => {
    it('normalizes the email, hashes the password, and delegates to the registration port', async () => {
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

    it('rejects a login for an email that does not exist without a distinguishing error', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@salon.com', password: 'x' }, meta),
      ).rejects.toBeInstanceOf(InvalidCredentialsException);
      expect(securityEvents.record).toHaveBeenCalledWith(
        'LOGIN_FAILURE',
        expect.objectContaining({ reason: 'no_such_account' }),
      );
    });

    it('rejects a login with the wrong password using the same error as an unknown account', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'owner@salon.com', password: 'wrong' }, meta),
      ).rejects.toBeInstanceOf(InvalidCredentialsException);
      expect(securityEvents.record).toHaveBeenCalledWith(
        'LOGIN_FAILURE',
        expect.objectContaining({ reason: 'bad_password' }),
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
});
