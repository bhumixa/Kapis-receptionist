/**
 * Namespaced settings categories (docs/TENANT_ARCHITECTURE.md, docs/adr/
 * ADR-006) — each an independently-extensible arbitrary JSON object. No
 * category has a fixed field schema yet; every namespace is owned by
 * whichever future milestone first needs a field in it:
 * - `business`/`notifications`: Scheduling (M5), AI (M7), Notifications (M9)
 * - `general`/`localization`/`security`: no concrete consumer yet
 *
 * This milestone only builds the container. Adding a field to a namespace
 * is an application-layer change (validate + read/write it), never a schema
 * migration — that's the entire point of the namespace-as-JSON-blob design.
 */
export interface TenantSettingsCategories {
  general: Record<string, unknown>;
  localization: Record<string, unknown>;
  business: Record<string, unknown>;
  notifications: Record<string, unknown>;
  security: Record<string, unknown>;
}

export interface TenantSettingsEntity extends TenantSettingsCategories {
  id: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

export const EMPTY_TENANT_SETTINGS_CATEGORIES: TenantSettingsCategories = {
  general: {},
  localization: {},
  business: {},
  notifications: {},
  security: {},
};
