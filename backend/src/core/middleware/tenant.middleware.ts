import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export const IMPERSONATE_TENANT_HEADER = 'x-impersonate-tenant-id';

declare module 'express' {
  interface Request {
    /**
     * The raw, **unvalidated** value of the `X-Impersonate-Tenant-Id`
     * header, if present — set by `TenantMiddleware` only. This is
     * deliberately not "the tenant to use": no role check and no
     * tenant-existence check has happened yet at this point in the
     * pipeline (middleware runs before `JwtAuthGuard`, so `request.user`
     * doesn't exist yet here).
     *
     * `TenantContextService` is the **only** place permitted to read this
     * field and turn it into an authoritative decision (docs/adr/ADR-006 —
     * "resolve tenant context exclusively through TenantMiddleware and
     * TenantContextService"). No controller, service, or guard should ever
     * read this field or the raw header directly.
     */
    impersonateTenantIdHeader?: string;
  }
}

/**
 * Stage 1 of tenant-context resolution (docs/TENANT_ARCHITECTURE.md,
 * docs/adr/ADR-006): pure, mechanical extraction of the impersonation
 * header, with no authorization logic at all — it runs for every request,
 * authenticated or not, long before any guard has established `request.user`.
 *
 * Stage 2 (the actual authority check — is this caller `SUPER_ADMIN`? does
 * the target tenant exist? — plus audit logging) lives entirely in
 * `TenantContextService`. Splitting it this way keeps this middleware
 * trivially safe (it can't accidentally grant tenant access to anyone,
 * since it makes no decisions) while giving `TenantContextService` a single
 * place to enforce "controllers must never inspect impersonation headers
 * directly."
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers[IMPERSONATE_TENANT_HEADER];
    if (typeof header === 'string' && header.length > 0) {
      req.impersonateTenantIdHeader = header;
    }
    next();
  }
}
