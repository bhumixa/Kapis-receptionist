/**
 * The genuinely-new business-facing fields Milestone 4 introduces. Tenant's
 * own identity fields (name/timezone/address/locale, already exposed via
 * `GET/PATCH /tenant` since Milestone 3) are deliberately NOT duplicated
 * here — see `SalonProfileView` for the composed read shape and
 * docs/adr/ADR-007-salon-management.md for the rationale.
 */
export interface SalonProfileEntity {
  id: string;
  tenantId: string;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  currency: string;
  /** Bare placeholder string — no Files/S3 module exists yet (docs/SALON_ARCHITECTURE.md). */
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_SALON_PROFILE_CURRENCY = 'USD';
