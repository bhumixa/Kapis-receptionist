import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  TenantSettingsCategories,
  TenantSettingsEntity,
} from '../domain/entities/tenant-settings.entity';
import { TenantSettingsRepositoryPort } from '../domain/ports/tenant-settings-repository.port';
import { toTenantSettingsEntity } from './mappers/prisma-tenant.mappers';

/**
 * Not a `TenantScopedRepository` subclass: `TenantSettings` is a 1:1 record
 * *keyed by* `tenantId` (its natural lookup key), not "many rows per tenant
 * each with their own id" — the pattern that base class targets. Every
 * query here is still unconditionally scoped to `tenantId`, just via a
 * direct unique lookup rather than the base class's `findFirst`-by-id
 * pattern.
 */
@Injectable()
export class PrismaTenantSettingsRepository implements TenantSettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string): Promise<TenantSettingsEntity | null> {
    const row = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });
    return row ? toTenantSettingsEntity(row) : null;
  }

  async createDefault(tenantId: string): Promise<TenantSettingsEntity> {
    const row = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
    return toTenantSettingsEntity(row);
  }

  async updateCategories(
    tenantId: string,
    partial: Partial<TenantSettingsCategories>,
  ): Promise<TenantSettingsEntity> {
    const existing = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    const merged: Partial<
      Record<keyof TenantSettingsCategories, Prisma.InputJsonValue>
    > = {};
    for (const key of Object.keys(
      partial,
    ) as (keyof TenantSettingsCategories)[]) {
      const incoming = partial[key];
      if (incoming === undefined) {
        continue;
      }
      // Shallow-merge into the existing namespace rather than replacing it
      // wholesale, so a `PATCH { general: { foo: 1 } }` never wipes out
      // unrelated keys already stored in that same namespace.
      const current =
        existing && typeof existing[key] === 'object' && existing[key] !== null
          ? (existing[key] as Record<string, unknown>)
          : {};
      merged[key] = { ...current, ...incoming } as Prisma.InputJsonValue;
    }

    const row = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: merged,
      create: { tenantId, ...merged },
    });
    return toTenantSettingsEntity(row);
  }
}
