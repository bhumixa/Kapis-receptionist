import { ServiceEntity } from '../entities/service.entity';

export const SERVICE_REPOSITORY = Symbol('SERVICE_REPOSITORY');

export interface CreateServiceInput {
  categoryId?: string | null;
  name: string;
  description?: string | null;
  durationMinutes: number;
  priceCents: number;
  currency?: string;
  bufferTimeMinutes?: number;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdateServiceInput {
  categoryId?: string | null;
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  priceCents?: number;
  currency?: string;
  bufferTimeMinutes?: number;
  isActive?: boolean;
  displayOrder?: number;
}

export type ServiceSortField = 'name' | 'priceCents' | 'displayOrder';

export interface ServiceListFilter {
  isActive?: boolean;
  categoryId?: string;
  q?: string;
  sortField: ServiceSortField;
  sortDirection: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface ServiceListResult {
  services: ServiceEntity[];
  total: number;
}

export interface ServiceRepositoryPort {
  findList(
    tenantId: string,
    filter: ServiceListFilter,
  ): Promise<ServiceListResult>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<ServiceEntity | null>;
  /** Used by `modules/employees` (via `ServicesService`) to validate a set of `serviceIds` belongs to the tenant. */
  findByIdsForTenant(tenantId: string, ids: string[]): Promise<ServiceEntity[]>;
  create(tenantId: string, input: CreateServiceInput): Promise<ServiceEntity>;
  update(
    tenantId: string,
    id: string,
    input: UpdateServiceInput,
  ): Promise<ServiceEntity>;
  /** Soft delete (`deletedAt`) — historical references (future `AppointmentService`) must survive. */
  softDelete(tenantId: string, id: string): Promise<void>;
}
