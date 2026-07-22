import { Inject, Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { TenantEntity } from '../domain/entities/tenant.entity';
import {
  type AdminTenantListFilter,
  type AdminTenantListResult,
  TENANT_REPOSITORY,
  type TenantRepositoryPort,
  type UpdateTenantProfileInput,
} from '../domain/ports/tenant-repository.port';

/**
 * `GET /tenant` / `PATCH /tenant` (API_SPECIFICATION.md Section 6). Reads
 * and writes the caller's own salon profile — the tenant id itself always
 * comes from the controller's resolved `TenantContextService` context,
 * never a client-supplied id (API_SPECIFICATION.md Section 2.14).
 */
@Injectable()
export class TenantService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  async getProfile(tenantId: string): Promise<TenantEntity> {
    return this.tenants.findById(tenantId).then(requireFound);
  }

  /**
   * Optional trailing `tx`: `modules/salon`'s `SalonProfileService` calls
   * this from inside its own `PATCH /salon` transaction so the Tenant-owned
   * subset of a combined salon-profile update commits atomically with the
   * `SalonProfile` write (docs/adr/ADR-007-salon-management.md). Omitting
   * `tx` (every pre-Milestone-4 call site) is unchanged.
   */
  async updateProfile(
    tenantId: string,
    actor: AccessTokenPayload,
    input: UpdateTenantProfileInput,
    tx?: Prisma.TransactionClient,
  ): Promise<TenantEntity> {
    const updated = await this.tenants.updateProfile(tenantId, input, tx);

    await this.auditLog.record(
      {
        action: 'TENANT_PROFILE_UPDATED',
        entityType: 'Tenant',
        entityId: tenantId,
        actorType: ActorType.USER,
        actorId: actor.sub,
        tenantId,
        metadata: { fields: Object.keys(input) },
      },
      tx,
    );

    return updated;
  }

  /** `GET /admin/tenants` (Milestone 3's narrow Admin slice) — Super-Admin-only cross-tenant listing, called only from `modules/admin`. */
  async listForAdmin(
    filter: AdminTenantListFilter,
  ): Promise<AdminTenantListResult> {
    return this.tenants.findManyForAdmin(filter);
  }
}

function requireFound(tenant: TenantEntity | null): TenantEntity {
  if (!tenant) {
    // TenantContextService already proved this tenant id resolves to a real
    // row before any controller could reach here — a miss at this point
    // means the row was deleted between resolution and this read, an
    // exceptionally narrow race not worth a bespoke error code for.
    throw new Error('Tenant not found despite a resolved tenant context.');
  }
  return tenant;
}
