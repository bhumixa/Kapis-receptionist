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

  /**
   * Concurrency-safe "create if missing" (surfaced by Milestone 6's
   * concurrent-booking test, docs/adr/ADR-009-scheduling-engine.md — the
   * first caller to invoke `getSettings` under genuine concurrent load,
   * since a normally-registered tenant already has its `TenantSettings` row
   * created atomically at `POST /auth/register`). `upsert()` alone is not
   * a sufficient guard: two concurrent calls can both miss the row on their
   * internal read and both attempt the insert branch, so the *second*
   * still raises a `P2002` unique-constraint violation on `tenantId`
   * despite being expressed as an upsert — caught here and treated as
   * "someone else just created it", re-reading rather than crashing.
   */
  async createDefault(tenantId: string): Promise<TenantSettingsEntity> {
    try {
      const row = await this.prisma.tenantSettings.upsert({
        where: { tenantId },
        update: {},
        create: { tenantId },
      });
      return toTenantSettingsEntity(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.tenantSettings.findUnique({
          where: { tenantId },
        });
        if (existing) {
          return toTenantSettingsEntity(existing);
        }
      }
      throw error;
    }
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
