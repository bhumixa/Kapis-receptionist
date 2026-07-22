import { Prisma } from '@prisma/client';
import { SalonProfileEntity } from '../entities/salon-profile.entity';

export const SALON_PROFILE_REPOSITORY = Symbol('SALON_PROFILE_REPOSITORY');

export interface UpdateSalonProfileFields {
  description?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  currency?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
}

/**
 * `SalonProfile` is a 1:1 record keyed by `tenantId` (its natural lookup
 * key), not "many rows per tenant" — mirrors
 * `modules/tenants/domain/ports/tenant-settings-repository.port.ts`'s same
 * precedent, not a `TenantScopedRepository` subclass.
 */
export interface SalonProfileRepositoryPort {
  findByTenantId(tenantId: string): Promise<SalonProfileEntity | null>;
  /** Idempotent create-if-absent — used by `GET /salon`'s auto-vivify-on-read. */
  createDefault(tenantId: string): Promise<SalonProfileEntity>;
  /**
   * Optional trailing `tx`: `SalonProfileService.updateProfile` composes
   * this with `TenantService.updateProfile` inside one
   * `prisma.$transaction` (docs/adr/ADR-007-salon-management.md).
   */
  upsert(
    tenantId: string,
    fields: UpdateSalonProfileFields,
    tx?: Prisma.TransactionClient,
  ): Promise<SalonProfileEntity>;
}
