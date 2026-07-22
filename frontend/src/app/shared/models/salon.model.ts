/** Mirrors `backend/src/modules/salon/interface/dto/salon-profile-response.dto.ts`. */
export interface SalonProfile {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  countryCode: string | null;
  timezone: string;
  defaultLocale: string;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  currency: string;
  /** Placeholder string — no Files/S3 module exists yet. */
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  updatedAt: string;
}
