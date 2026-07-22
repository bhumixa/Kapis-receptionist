import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { ActorType, RoleName } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AccessTokenPayload } from '../../modules/auth/application/token.service';
import type { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';
import { AuditLogService } from '../audit/audit-log.service';
import {
  InvalidTenantContextException,
  TenantResourceNotFoundException,
} from '../guards/rbac.exceptions';

/**
 * Request-scoped tenant/user context (SYSTEM_ARCHITECTURE.md Section 8.3) —
 * the **sole, authoritative** resolver of "which tenant is this request
 * for" (docs/adr/ADR-006). Every tenant-scoped guard/service calls this,
 * never `request.user.tenantId` or the impersonation header directly.
 *
 * Resolution rules:
 * - Non-`SUPER_ADMIN` callers: always the JWT's own `tenantId` claim. The
 *   `X-Impersonate-Tenant-Id` header (`TenantMiddleware`) is read but has
 *   **zero effect** for these callers — this is the spoofing-protection
 *   property: a non-admin cannot act on another tenant by sending a header.
 * - `SUPER_ADMIN` with no impersonation header: `null` (no fixed tenant by
 *   design — a valid, expected state for e.g. `/auth/me`, not an error).
 * - `SUPER_ADMIN` with an impersonation header: the header's tenant, after
 *   verifying it resolves to a real, non-deleted `Tenant` row (a
 *   nonexistent/deleted target throws `TenantResourceNotFoundException` —
 *   404, never 403, per the platform's anti-enumeration convention) — and
 *   every successful resolution is recorded via `AuditLogService`
 *   (`SUPER_ADMIN_TENANT_SWITCH`).
 *
 * Resolution runs at most once per request: the result (and whether it's
 * been computed yet) is memoized on this instance, and Nest's request-scope
 * DI guarantees every consumer within one request shares this same
 * instance — so calling this from a guard *and* later from a service in the
 * same request only hits the database/audit-log once.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private resolution?: Promise<string | null>;

  constructor(
    @Inject(REQUEST) private readonly request: AuthenticatedRequest,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Resolved tenant id, or `null` if there genuinely isn't one (e.g. a non-impersonating Super Admin). */
  getTenantId(): Promise<string | null> {
    if (!this.resolution) {
      this.resolution = this.resolve();
    }
    return this.resolution;
  }

  /** Same as `getTenantId()`, but throws when no tenant context is resolvable — for genuinely tenant-scoped operations. */
  async requireTenantId(): Promise<string> {
    const tenantId = await this.getTenantId();
    if (!tenantId) {
      throw new InvalidTenantContextException();
    }
    return tenantId;
  }

  getCurrentUser(): AccessTokenPayload {
    return this.request.user;
  }

  private async resolve(): Promise<string | null> {
    const { user } = this.request;
    const isSuperAdmin = user.roles.includes(RoleName.SUPER_ADMIN);
    const impersonationHeader = this.request.impersonateTenantIdHeader;

    if (!isSuperAdmin) {
      // Spoofing protection: the header is never consulted for a non-Super-Admin
      // caller, even if present — the JWT's own claim is the only source.
      return user.tenantId;
    }

    if (!impersonationHeader) {
      return null;
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: impersonationHeader, deletedAt: null },
      select: { id: true },
    });

    if (!tenant) {
      throw new TenantResourceNotFoundException();
    }

    await this.auditLog.record({
      action: 'SUPER_ADMIN_TENANT_SWITCH',
      entityType: 'Tenant',
      entityId: tenant.id,
      actorType: ActorType.USER,
      actorId: user.sub,
      tenantId: tenant.id,
      metadata: { route: `${this.request.method} ${this.request.originalUrl}` },
      ipAddress: this.request.ip ?? null,
    });

    return tenant.id;
  }
}
