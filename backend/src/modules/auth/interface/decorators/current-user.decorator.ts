import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenPayload } from '../../application/token.service';
import { AuthenticatedRequest } from '../types/authenticated-request.interface';

/** Reads the JWT claims `JwtAuthGuard` attached to the request — only valid behind that guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
