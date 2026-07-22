/**
 * Mirrors `GET/PATCH /api/v1/tenant/settings` (docs/TENANT_ARCHITECTURE.md).
 * Five independently-extensible namespaces, each an arbitrary JSON object —
 * no namespace has concrete fields defined yet at this milestone; every
 * future module (Scheduling/AI/Notifications/Billing-security) populates
 * its own namespace without a contract change here.
 */
export interface TenantSettings {
  general: Record<string, unknown>;
  localization: Record<string, unknown>;
  business: Record<string, unknown>;
  notifications: Record<string, unknown>;
  security: Record<string, unknown>;
  updatedAt: string;
}

export type TenantSettingsCategory = keyof Omit<TenantSettings, 'updatedAt'>;

export const TENANT_SETTINGS_CATEGORIES: TenantSettingsCategory[] = [
  'general',
  'localization',
  'business',
  'notifications',
  'security',
];
