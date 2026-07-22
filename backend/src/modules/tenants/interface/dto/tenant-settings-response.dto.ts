/** API response shape for `GET/PATCH /tenant/settings`. */
export interface TenantSettingsResponseDto {
  general: Record<string, unknown>;
  localization: Record<string, unknown>;
  business: Record<string, unknown>;
  notifications: Record<string, unknown>;
  security: Record<string, unknown>;
  updatedAt: string;
}
