import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import {
  TenantSettingsCategories,
  TenantSettingsEntity,
} from '../domain/entities/tenant-settings.entity';
import {
  TENANT_SETTINGS_REPOSITORY,
  type TenantSettingsRepositoryPort,
} from '../domain/ports/tenant-settings-repository.port';

/**
 * `GET /tenant/settings` / `PATCH /tenant/settings` (API_SPECIFICATION.md
 * Section 6, restructured per the requester's brief into five namespaced
 * categories — see `tenant-settings.entity.ts`).
 */
@Injectable()
export class TenantSettingsService {
  constructor(
    @Inject(TENANT_SETTINGS_REPOSITORY)
    private readonly settings: TenantSettingsRepositoryPort,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Every tenant gets a `TenantSettings` row created atomically at
   * registration (`PrismaRegistrationRepository`) — the defensive
   * `createDefault` fallback here only matters for a tenant created before
   * this milestone's migration landed, or in the unlikely event that row
   * was somehow lost.
   */
  async getSettings(tenantId: string): Promise<TenantSettingsEntity> {
    const existing = await this.settings.findByTenantId(tenantId);
    if (existing) {
      return existing;
    }
    return this.settings.createDefault(tenantId);
  }

  async updateSettings(
    tenantId: string,
    actor: AccessTokenPayload,
    partial: Partial<TenantSettingsCategories>,
  ): Promise<TenantSettingsEntity> {
    await this.getSettings(tenantId); // ensures a row exists before the update
    const updated = await this.settings.updateCategories(tenantId, partial);

    await this.auditLog.record({
      action: 'TENANT_SETTINGS_UPDATED',
      entityType: 'TenantSettings',
      entityId: updated.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { categories: Object.keys(partial) },
    });

    return updated;
  }
}
