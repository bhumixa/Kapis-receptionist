import { TenantStatus } from '@prisma/client';

/** API_SPECIFICATION.md Section 3 `TenantDTO`. */
export interface TenantResponseDto {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  timezone: string;
  addressLine1: string | null;
  city: string | null;
  countryCode: string | null;
  defaultLocale: string;
  /** Always `null` this sprint — Files/logo upload is Milestone 4 (PRISMA_SCHEMA.md `Tenant.logoFileId`). */
  logoUrl: string | null;
  trialEndsAt: string | null;
  createdAt: string;
}
