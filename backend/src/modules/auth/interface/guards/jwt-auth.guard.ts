import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../application/token.service';
import { AuthenticatedRequest } from '../types/authenticated-request.interface';

/**
 * Verifies the `Authorization: Bearer <accessToken>` header
 * (SYSTEM_ARCHITECTURE.md Section 7.1) and attaches the decoded claims to
 * `request.user`. A hand-rolled guard rather than `@nestjs/passport` +
 * `passport-jwt` — this module has exactly one token type to verify, so a
 * full Passport strategy would be an unused-abstraction cost; future
 * guards (`RolesGuard`/`TenantScopedGuard`, Milestone 3, SYSTEM_ARCHITECTURE.md
 * Section 7.3) read from this same `request.user` shape.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      request.user = this.tokenService.verifyAccessToken(token);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
