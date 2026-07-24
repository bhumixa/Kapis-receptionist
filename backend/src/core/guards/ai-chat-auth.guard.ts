import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { TokenService } from '../../modules/auth/application/token.service';
import type { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { satisfiesRoleRequirement } from '../../common/constants/rbac.constants';
import { InsufficientRoleException } from './rbac.exceptions';
import { InternalServiceAuthGuard } from './internal-service-auth.guard';
import { InvalidInternalCredentialException } from './internal-service-auth.exceptions';

/**
 * `POST /ai/chat`'s dual-mode auth (API_SPECIFICATION.md Section 12):
 * internal-service credential (the webhook-pipeline/eval-suite path) **or**
 * a `MANAGER`+ JWT (the dashboard "Test my AI" sandbox, `channel:
 * "dashboard_test"`). Mode is selected by the presence of the internal
 * API-key header — if present, it must be valid (no silent fall-through to
 * JWT on a wrong key, which would let a caller probe for the JWT path by
 * sending garbage); if absent, standard JWT verification + role check runs,
 * equivalent to stacking `JwtAuthGuard`+`RolesGuard(MANAGER)` but as one
 * guard, since Nest guards can't easily express "either of these two".
 */
@Injectable()
export class AiChatAuthGuard implements CanActivate {
  constructor(
    private readonly internalServiceAuthGuard: InternalServiceAuthGuard,
    private readonly tokenService: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const hasInternalKeyHeader =
      typeof request.headers['x-internal-api-key'] === 'string';

    if (hasInternalKeyHeader) {
      return this.internalServiceAuthGuard.canActivate(context);
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new InvalidInternalCredentialException();
    }

    try {
      request.user = this.tokenService.verifyAccessToken(token);
    } catch {
      throw new InvalidInternalCredentialException();
    }

    if (!satisfiesRoleRequirement(request.user.roles, [RoleName.MANAGER])) {
      throw new InsufficientRoleException([RoleName.MANAGER]);
    }

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
