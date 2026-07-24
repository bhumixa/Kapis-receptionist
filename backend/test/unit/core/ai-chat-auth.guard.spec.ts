import { ExecutionContext } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { AiChatAuthGuard } from '../../../src/core/guards/ai-chat-auth.guard';
import { InternalServiceAuthGuard } from '../../../src/core/guards/internal-service-auth.guard';
import { InvalidInternalCredentialException } from '../../../src/core/guards/internal-service-auth.exceptions';
import { InsufficientRoleException } from '../../../src/core/guards/rbac.exceptions';
import { TokenService } from '../../../src/modules/auth/application/token.service';

function makeContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request = { headers, user: undefined as unknown };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AiChatAuthGuard', () => {
  let internalGuard: jest.Mocked<Pick<InternalServiceAuthGuard, 'canActivate'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'verifyAccessToken'>>;
  let guard: AiChatAuthGuard;

  beforeEach(() => {
    internalGuard = { canActivate: jest.fn().mockReturnValue(true) };
    tokenService = { verifyAccessToken: jest.fn() };
    guard = new AiChatAuthGuard(
      internalGuard as unknown as InternalServiceAuthGuard,
      tokenService as unknown as TokenService,
    );
  });

  it('delegates to InternalServiceAuthGuard when the internal-api-key header is present', () => {
    const { context } = makeContext({ 'x-internal-api-key': 'k' });

    expect(guard.canActivate(context)).toBe(true);
    expect(internalGuard.canActivate).toHaveBeenCalledWith(context);
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects with no Authorization header and no internal key', () => {
    const { context } = makeContext({});
    expect(() => guard.canActivate(context)).toThrow(
      InvalidInternalCredentialException,
    );
  });

  it('accepts a valid MANAGER+ JWT for the dashboard-test path', () => {
    tokenService.verifyAccessToken.mockReturnValue({
      sub: 'user-1',
      email: 'owner@bellasalon.com',
      tenantId: 'tenant-1',
      roles: [RoleName.OWNER],
    });
    const { context, request } = makeContext({
      authorization: 'Bearer valid-token',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBeDefined();
  });

  it('rejects a valid JWT belonging to a STAFF role (below the MANAGER floor)', () => {
    tokenService.verifyAccessToken.mockReturnValue({
      sub: 'user-2',
      email: 'staff@bellasalon.com',
      tenantId: 'tenant-1',
      roles: [RoleName.STAFF],
    });
    const { context } = makeContext({ authorization: 'Bearer valid-token' });

    expect(() => guard.canActivate(context)).toThrow(InsufficientRoleException);
  });

  it('rejects a malformed/invalid JWT', () => {
    tokenService.verifyAccessToken.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const { context } = makeContext({ authorization: 'Bearer garbage' });

    expect(() => guard.canActivate(context)).toThrow(
      InvalidInternalCredentialException,
    );
  });
});
