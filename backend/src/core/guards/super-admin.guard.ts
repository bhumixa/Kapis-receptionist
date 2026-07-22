import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { InsufficientRoleException } from './rbac.exceptions';

/**
 * Strict `SUPER_ADMIN`-only guard, structurally distinct from a "role that
 * happens to bypass tenant checks" (SYSTEM_ARCHITECTURE.md Section 8.4).
 * No bypass logic — this guard *is* the check, so there is nothing to
 * bypass. Reserved for the future `/admin/*` surface (docs/adr/
 * ADR-005-rbac.md); unused this sprint, built ahead of its first consumer
 * the same way `JwtAuthGuard` was.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user.roles.includes(RoleName.SUPER_ADMIN)) {
      throw new InsufficientRoleException([RoleName.SUPER_ADMIN]);
    }
    return true;
  }
}
