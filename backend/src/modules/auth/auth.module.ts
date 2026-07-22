import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { REFRESH_TOKEN_REPOSITORY } from './domain/ports/refresh-token-repository.port';
import { REGISTRATION_REPOSITORY } from './domain/ports/registration-repository.port';
import { TENANT_REPOSITORY } from './domain/ports/tenant-repository.port';
import { USER_REPOSITORY } from './domain/ports/user-repository.port';
import { AuthService } from './application/auth.service';
import { PasswordService } from './application/password.service';
import { SecurityEventService } from './application/security-event.service';
import { SessionService } from './application/session.service';
import { TokenService } from './application/token.service';
import { PrismaRefreshTokenRepository } from './infrastructure/prisma-refresh-token.repository';
import { PrismaRegistrationRepository } from './infrastructure/prisma-registration.repository';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { AuthController } from './interface/auth.controller';
import { JwtAuthGuard } from './interface/guards/jwt-auth.guard';
import {
  THROTTLE_PUBLIC_SENSITIVE,
  THROTTLE_STANDARD_AUTHENTICATED,
} from '../../common/constants/auth.constants';

@Module({
  imports: [
    // No default secret/expiry here — TokenService passes both explicitly
    // per call (access-token-only usage; the refresh token is never a JWT,
    // see token.service.ts).
    JwtModule.register({}),
    // API_SPECIFICATION.md Section 2.10. Registered here (not app-wide) so
    // this module's rate limits stay scoped to Auth's own routes — see
    // AuthController's per-route @SkipThrottle/@Throttle composition.
    ThrottlerModule.forRoot([
      { name: THROTTLE_PUBLIC_SENSITIVE, ttl: 60_000, limit: 10 },
      { name: THROTTLE_STANDARD_AUTHENTICATED, ttl: 60_000, limit: 120 },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    SecurityEventService,
    JwtAuthGuard,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    {
      provide: REFRESH_TOKEN_REPOSITORY,
      useClass: PrismaRefreshTokenRepository,
    },
    {
      provide: REGISTRATION_REPOSITORY,
      useClass: PrismaRegistrationRepository,
    },
  ],
  // TokenService/JwtAuthGuard exported for Milestone 3's RolesGuard/
  // TenantScopedGuard (SYSTEM_ARCHITECTURE.md Section 7.3) to compose with.
  exports: [TokenService, JwtAuthGuard],
})
export class AuthModule {}
