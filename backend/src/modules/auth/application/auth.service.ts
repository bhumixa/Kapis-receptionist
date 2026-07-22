import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthTenant } from '../domain/entities/auth-tenant.entity';
import { AuthUser } from '../domain/entities/auth-user.entity';
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
  EmailAlreadyExistsException,
  InvalidCredentialsException,
} from './exceptions/auth.exceptions';
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
 * PasswordService/TokenService/SessionService/SecurityEventService against
 * the repository ports. Controllers call only this; no business logic
 * lives in `interface/auth.controller.ts` (coding standards Section 12.5).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(REGISTRATION_REPOSITORY)
    private readonly registration: RegistrationRepositoryPort,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly securityEvents: SecurityEventService,
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

    return result;
  }

  async login(
    input: LoginInput,
    meta: RequestMeta,
  ): Promise<AuthenticatedSession> {
    const email = normalizeEmail(input.email);
    const user = await this.users.findByEmail(email);

    if (!user || !user.passwordHash) {
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

  async me(
    userId: string,
  ): Promise<{ user: AuthUser; tenant: AuthTenant | null }> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    const tenant = user.tenantId
      ? await this.tenants.findById(user.tenantId)
      : null;

    return { user, tenant };
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
