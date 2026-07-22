/** `GET/PATCH /salon` response body. */
export interface SalonProfileResponseDto {
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
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  updatedAt: string;
}
