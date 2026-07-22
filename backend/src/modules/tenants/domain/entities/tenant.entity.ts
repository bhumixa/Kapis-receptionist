import { TenantStatus } from '@prisma/client';

export interface TenantEntity {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  timezone: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  countryCode: string | null;
  defaultLocale: string;
  trialEndsAt: Date | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
