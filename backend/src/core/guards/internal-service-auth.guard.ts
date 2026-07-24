import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleName } from '@prisma/client';
import type { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import {
  InvalidInternalCredentialException,
  MissingInternalTenantException,
} from './internal-service-auth.exceptions';
import { verifyInternalApiKey } from './internal-service-auth.util';

export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key';
export const INTERNAL_TENANT_ID_HEADER = 'x-tenant-id';

/**
 * The AI receptionist's internal-service-credential auth (API_SPECIFICATION.md
 * Section 12, docs/AI_ARCHITECTURE.md) — guards `POST /ai/tools/*` and the
 * internal-service mode of `POST /ai/chat`. No such mechanism existed
 * anywhere in this codebase before Milestone 8; the only prior non-JWT trust
 * boundary was WhatsApp's webhook HMAC-signature check
 * (`whatsapp-signature.util.ts`), which is single-purpose and not reusable
 * here (there's no third party signing these requests — this is the
 * platform's own orchestration process calling its own API).
 *
 * The real production traffic path never hits this guard at all (SYSTEM_
 * ARCHITECTURE.md Section 5.3: tool execution is in-process module calls,
 * docs/adr/ADR-011) — it exists for the QA/eval/future-extraction HTTP
 * surface API_SPECIFICATION.md Section 12's architectural note describes.
 *
 * Critically, this guard **populates `request.user`** with a synthetic,
 * role-less `AccessTokenPayload` after validating the shared secret —
 * `TenantContextService`/`IdempotencyInterceptor` (required on the three
 * mutating tool endpoints) both read `request.user` transitively, and
 * without this they throw on a request that carries no JWT. An
 * internal-service request carries no tenant claim either, so tenant is
 * read from `X-Tenant-Id` — the same header-based-context precedent
 * `X-Impersonate-Tenant-Id` already established
 * (`core/middleware/tenant.middleware.ts`), just consumed directly here
 * rather than through that middleware (this guard runs its own trust
 * check first; there's no JWT-authenticated caller to spoof).
 */
@Injectable()
export class InternalServiceAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const providedKey = request.headers[INTERNAL_API_KEY_HEADER];
    const expectedKey =
      this.configService.getOrThrow<string>('ai.internalApiKey');

    if (
      typeof providedKey !== 'string' ||
      !verifyInternalApiKey(expectedKey, providedKey)
    ) {
      throw new InvalidInternalCredentialException();
    }

    const tenantIdHeader = request.headers[INTERNAL_TENANT_ID_HEADER];
    if (typeof tenantIdHeader !== 'string' || tenantIdHeader.length === 0) {
      throw new MissingInternalTenantException();
    }

    request.user = {
      sub: 'internal-service',
      email: 'internal-service@system.local',
      tenantId: tenantIdHeader,
      roles: [] as RoleName[],
    };

    return true;
  }
}
