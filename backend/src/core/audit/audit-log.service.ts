import { Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface RecordAuditEventInput {
  /** Stable, machine-readable action key, e.g. `TENANT_SUSPENDED`, `SUPER_ADMIN_TENANT_SWITCH`. */
  action: string;
  /** The entity type this event is about, e.g. `Tenant`, `TenantInvitation`. */
  entityType: string;
  entityId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  /** `null` for genuinely platform-level events with no single owning tenant. */
  tenantId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Platform-wide, append-only audit trail (docs/TENANT_ARCHITECTURE.md,
 * docs/adr/ADR-006) — a deliberate pull-forward of `AuditLog` from Milestone
 * 9 (the same precedent ADR-002 already set for `Tenant`/`TenantInvitation`).
 *
 * Deliberately **not** tenant-specific: `tenantId` is nullable so this same
 * table/service records both tenant-scoped business events (settings
 * changed, invitation created) and genuinely platform-level events with no
 * single owning tenant (e.g. a future cross-tenant admin action). Any
 * module — not just Tenants — can inject this and record its own `action`/
 * `entityType` values; nothing here is Tenant-specific business logic.
 *
 * Distinct from `SecurityEventService` (auth/RBAC structured log lines,
 * still not a persisted table, unchanged Milestone 9 scope) — this is the
 * queryable, persisted counterpart for *business-significant* events
 * (DATABASE_DESIGN.md Section 8.2's audit_logs/activity_logs split).
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Optional trailing `tx`: lets a caller that's already inside a
   * `prisma.$transaction` (e.g. `modules/salon`'s `SalonProfileService`,
   * docs/adr/ADR-007-salon-management.md) write its audit entry as part of
   * the same atomic unit, so a later failure/rollback in that transaction
   * can't leave a stale audit row behind claiming a change that never
   * actually committed. Every existing call site omits `tx` and behaves
   * exactly as before (writes immediately via the singleton client).
   */
  async record(
    input: RecordAuditEventInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        metadata: (input.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }

  /**
   * Read access for whichever future screen surfaces this (a tenant's own
   * activity view, or the Super Admin console) — filters are intentionally
   * minimal (only what this milestone needs) and grow as real consumers
   * appear, not speculatively.
   */
  async findForTenant(tenantId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
