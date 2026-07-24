import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServiceAuthGuard } from '../../../src/core/guards/internal-service-auth.guard';
import {
  InvalidInternalCredentialException,
  MissingInternalTenantException,
} from '../../../src/core/guards/internal-service-auth.exceptions';

const REAL_KEY = 'a'.repeat(40);

function makeContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request = { headers, user: undefined as unknown };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('InternalServiceAuthGuard', () => {
  let configService: jest.Mocked<Pick<ConfigService, 'getOrThrow'>>;
  let guard: InternalServiceAuthGuard;

  beforeEach(() => {
    configService = { getOrThrow: jest.fn().mockReturnValue(REAL_KEY) };
    guard = new InternalServiceAuthGuard(
      configService as unknown as ConfigService,
    );
  });

  it('rejects a missing X-Internal-Api-Key header', () => {
    const { context } = makeContext({ 'x-tenant-id': 'tenant-1' });
    expect(() => guard.canActivate(context)).toThrow(
      InvalidInternalCredentialException,
    );
  });

  it('rejects a wrong key (constant-time comparison, not a throw on length mismatch)', () => {
    const { context } = makeContext({
      'x-internal-api-key': 'short-and-wrong',
      'x-tenant-id': 'tenant-1',
    });
    expect(() => guard.canActivate(context)).toThrow(
      InvalidInternalCredentialException,
    );
  });

  it('rejects a valid key with no X-Tenant-Id header', () => {
    const { context } = makeContext({ 'x-internal-api-key': REAL_KEY });
    expect(() => guard.canActivate(context)).toThrow(
      MissingInternalTenantException,
    );
  });

  it('accepts a valid key + tenant header and populates request.user for TenantContextService/IdempotencyInterceptor', () => {
    const { context, request } = makeContext({
      'x-internal-api-key': REAL_KEY,
      'x-tenant-id': 'tenant-42',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({
      sub: 'internal-service',
      email: 'internal-service@system.local',
      tenantId: 'tenant-42',
      roles: [],
    });
  });
});
