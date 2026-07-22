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

  private async requireTenant(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new TenantResourceNotFoundException();
    }
    return tenant;
  }
}
