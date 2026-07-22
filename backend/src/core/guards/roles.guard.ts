import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '@prisma/client';
import { satisfiesRoleRequirement } from '../../common/constants/rbac.constants';
import { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { InsufficientRoleException } from './rbac.exceptions';
import { SuperAdminBypassService } from './super-admin-bypass.service';

/**
 * Enforces `@Roles()` (docs/adr/ADR-005-rbac.md). Opt-in: a route with no
 * `@Roles()` metadata is unrestricted by this guard (beyond whatever
 * `JwtAuthGuard` already required). Must run after `JwtAuthGuard` — reads
 * `request.user` set by it.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly bypass: SuperAdminBypassService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleName[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (
      this.bypass.checkAndLog(request.user, context, {
        type: 'role',
        requiredRoles,
      })
    ) {
      return true;
    }

    if (!satisfiesRoleRequirement(request.user.roles, requiredRoles)) {
      throw new InsufficientRoleException(requiredRoles);
    }

    return true;
  }
}
