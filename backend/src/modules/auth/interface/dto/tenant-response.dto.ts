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
  /**
   * Always `null` — superseded by `GET /salon`'s own `logoUrl` (Milestone 4,
   * a placeholder string on `SalonProfile`, docs/SALON_ARCHITECTURE.md).
   * Left dormant here rather than wired up, to avoid colliding with
   * PRISMA_SCHEMA.md's still-reserved `Tenant.logoFileId` (a real,
   * S3-backed field for a future Files module).
   */
  logoUrl: string | null;
  trialEndsAt: string | null;
  createdAt: string;
}
