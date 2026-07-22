import { Prisma, TenantStatus } from '@prisma/client';
import { TenantEntity } from '../entities/tenant.entity';

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

export interface UpdateTenantProfileInput {
  name?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  countryCode?: string | null;
  timezone?: string;
  defaultLocale?: string;
}

export interface AdminTenantListFilter {
  status?: TenantStatus;
  q?: string;
  page: number;
  limit: number;
}

export interface AdminTenantListResult {
  tenants: TenantEntity[];
  total: number;
}

/**
 * The Tenants module's own `Tenant` repository — deliberately separate from
 * `modules/auth/domain/ports/tenant-repository.port.ts` (a minimal,
 * read-only-by-id port Auth owns for its own login/me needs). Each module
 * owns its own data-access port onto the shared `tenants` table
 * (SYSTEM_ARCHITECTURE.md Section 2.3 — "no module reaches into another
 * module's Prisma models directly").
 */
export interface TenantRepositoryPort {
  findById(id: string): Promise<TenantEntity | null>;
  /**
   * Optional trailing `tx`: lets `modules/salon`'s `SalonProfileService`
   * compose this write with its own `SalonProfile` upsert inside one
   * `prisma.$transaction`, so `PATCH /salon` can't partially apply (docs/
   * adr/ADR-007-salon-management.md). Every existing call site omits `tx`
   * and is unaffected — defaults to the singleton `PrismaService`.
   */
  updateProfile(
    id: string,
    input: UpdateTenantProfileInput,
    tx?: Prisma.TransactionClient,
  ): Promise<TenantEntity>;
  updateStatus(
    id: string,
    status: TenantStatus,
    extra?: { suspendedAt?: Date | null },
  ): Promise<TenantEntity>;
  findManyForAdmin(
    filter: AdminTenantListFilter,
  ): Promise<AdminTenantListResult>;
}
