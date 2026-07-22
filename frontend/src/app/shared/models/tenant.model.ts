/** Mirrors docs/API_SPECIFICATION.md Section 3 `TenantDTO`. */
export type TenantStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  timezone: string;
  addressLine1: string | null;
  city: string | null;
  countryCode: string | null;
  defaultLocale: string;
  logoUrl: string | null;
  trialEndsAt: string | null;
  createdAt: string;
}
