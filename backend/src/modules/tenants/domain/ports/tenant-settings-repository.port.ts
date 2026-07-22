import {
  TenantSettingsCategories,
  TenantSettingsEntity,
} from '../entities/tenant-settings.entity';

export const TENANT_SETTINGS_REPOSITORY = Symbol('TENANT_SETTINGS_REPOSITORY');

export interface TenantSettingsRepositoryPort {
  findByTenantId(tenantId: string): Promise<TenantSettingsEntity | null>;
  /** Idempotent-ish create: used both at registration and as a defensive backfill for pre-migration tenants. */
  createDefault(tenantId: string): Promise<TenantSettingsEntity>;
  /** Shallow-merges each provided category's keys into the existing JSON object — never replaces a category wholesale. */
  updateCategories(
    tenantId: string,
    partial: Partial<TenantSettingsCategories>,
  ): Promise<TenantSettingsEntity>;
}
