import { Inject, Injectable } from '@nestjs/common';
import { ActorType, TenantStatus } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { TenantEntity } from '../domain/entities/tenant.entity';
import {
  TENANT_REPOSITORY,
  type TenantRepositoryPort,
} from '../domain/ports/tenant-repository.port';
import { InvalidTenantLifecycleTransitionException } from './exceptions/tenant.exceptions';

/**
 * Tenant status transitions (SYSTEM_ARCHITECTURE.md Section 3.2's
 * `TenantsService.suspendTenant`/`reactivateTenant`), reachable only via
 * the Super-Admin-only `/admin/tenants/:id/{suspend,reactivate}` endpoints
 * (Milestone 3's narrow Admin slice). Deliberately does **not** implement
 * `CANCELLED` — that transition is tied to subscription cancellation
 * (Billing, Milestone 8, explicitly out of this milestone's scope).
 */
@Injectable()
export class TenantLifecycleService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async suspend(
    tenantId: string,
    actor: AccessTokenPayload,
    reason?: string,
  ): Promise<TenantEntity> {
    const tenant = await this.requireTenant(tenantId);

    if (tenant.status === TenantStatus.SUSPENDED) {
      return tenant; // idempotent no-op
    }
    if (tenant.status === TenantStatus.CANCELLED) {
      throw new InvalidTenantLifecycleTransitionException(
        tenant.status,
        TenantStatus.SUSPENDED,
      );
    }

    const updated = await this.tenants.updateStatus(
      tenantId,
      TenantStatus.SUSPENDED,
      { suspendedAt: new Date() },
    );

    await this.auditLog.record({
      action: 'TENANT_SUSPENDED',
      entityType: 'Tenant',
      entityId: tenantId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { reason: reason ?? null, previousStatus: tenant.status },
    });

    return updated;
  }

  async reactivate(
    tenantId: string,
    actor: AccessTokenPayload,
  ): Promise<TenantEntity> {
    const tenant = await this.requireTenant(tenantId);

    if (tenant.status !== TenantStatus.SUSPENDED) {
      throw new InvalidTenantLifecycleTransitionException(
        tenant.status,
        TenantStatus.ACTIVE,
      );
    }

    const updated = await this.tenants.updateStatus(
      tenantId,
      TenantStatus.ACTIVE,
      { suspendedAt: null },
    );

    await this.auditLog.record({
      action: 'TENANT_REACTIVATED',
      entityType: 'Tenant',
      entityId: tenantId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { previousStatus: tenant.status },
    });

    return updated;
  }

  /**
   * Milestone 9 (docs/BILLING_ARCHITECTURE.md) — called by
   * `StripeEventProcessorService` to keep `Tenant.status` in sync with
   * `Subscription.status` as Stripe webhooks arrive. Deliberately does
   * **not** reuse `suspend`/`reactivate`'s human-actor transition rules
   * (idempotent-no-op guard, `InvalidTenantLifecycleTransitionException`)
   * — a billing sync always mirrors Stripe's current truth and must apply
   * unconditionally, including transitions those methods don't allow
   * (`PAST_DUE`, `CANCELLED`) and out-of-order webhook delivery safely
   * converging to the same end state. Grace-period policy (PROJECT_
   * REQUIREMENTS.md Section 22 Q9, resolved this milestone): `PAST_DUE`
   * stays fully functional (only `SUSPENDED`/`CANCELLED` block mutating
   * routes via `TenantActiveGuard`) until Stripe's own dunning retries are
   * exhausted (`Subscription.status` becomes `UNPAID`, mapped to
   * `SUSPENDED` here) or the subscription is canceled outright.
   */
  async syncStatusFromBilling(
    tenantId: string,
    status: TenantStatus,
    extra: { suspendedAt?: Date | null; trialEndsAt?: Date | null } = {},
    metadata?: Record<string, unknown>,
  ): Promise<TenantEntity> {
    const tenant = await this.requireTenant(tenantId);
    if (tenant.status === status && Object.keys(extra).length === 0) {
      return tenant;
    }

    const updated = await this.tenants.updateStatus(tenantId, status, extra);

    await this.auditLog.record({
      action: 'TENANT_STATUS_SYNCED_FROM_BILLING',
      entityType: 'Tenant',
      entityId: tenantId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      tenantId,
      metadata: {
        previousStatus: tenant.status,
        newStatus: status,
        ...metadata,
      },
    });

    return updated;
  }

  private async requireTenant(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new TenantResourceNotFoundException();
    }
    return tenant;
  }
}
