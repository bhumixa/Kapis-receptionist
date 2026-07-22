import { TenantStatus } from '@prisma/client';

/** The Auth module's own view of a tenant (see auth-user.entity.ts note). */
export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  timezone: string;
  addressLine1: string | null;
  city: string | null;
  countryCode: string | null;
  defaultLocale: string;
  trialEndsAt: Date | null;
  createdAt: Date;
}
