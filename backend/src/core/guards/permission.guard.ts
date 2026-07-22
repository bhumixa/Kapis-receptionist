import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionResolverService } from '../permission-resolver.service';
import { InsufficientPermissionException } from './rbac.exceptions';
import { SuperAdminBypassService } from './super-admin-bypass.service';

/**
 * Enforces `@RequirePermission()` (docs/adr/ADR-005-rbac.md). Opt-in: a
 * route with no `@RequirePermission()` metadata is unrestricted by this
 * guard. Must run after `JwtAuthGuard` — reads `request.user` set by it.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly bypass: SuperAdminBypassService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (
      this.bypass.checkAndLog(request.user, context, {
        type: 'permission',
        requiredPermission,
      })
    ) {
      return true;
    }

    const allowed = await this.permissionResolver.hasPermission(
      request.user.roles,
      requiredPermission,
    );
    if (!allowed) {
      throw new InsufficientPermissionException(requiredPermission);
    }

    return true;
  }
}
