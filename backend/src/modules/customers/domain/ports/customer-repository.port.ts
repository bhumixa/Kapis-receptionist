import type { CursorPayload } from '../../../../common/utils/cursor-pagination.util';
import { CustomerEntity } from '../entities/customer.entity';

export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY');

export interface CreateCustomerInput {
  phoneNumber: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  preferredLanguage?: string | null;
  marketingOptIn?: boolean;
}

export interface UpdateCustomerInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  preferredLanguage?: string | null;
  marketingOptIn?: boolean;
}

export type CustomerSortField = 'firstName' | 'createdAt';

export interface CustomerListFilter {
  marketingOptIn?: boolean;
  q?: string;
  sortField: CustomerSortField;
  sortDirection: 'asc' | 'desc';
  cursor: CursorPayload | null;
  limit: number;
}

export interface CustomerRepositoryPort {
  findList(
    tenantId: string,
    filter: CustomerListFilter,
  ): Promise<CustomerEntity[]>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<CustomerEntity | null>;
  /** Used by `modules/appointments` to validate a `customerId` belongs to the tenant. */
  findByIdsForTenant(
    tenantId: string,
    ids: string[],
  ): Promise<CustomerEntity[]>;
  findByPhoneForTenant(
    tenantId: string,
    phoneNumber: string,
  ): Promise<CustomerEntity | null>;
  create(tenantId: string, input: CreateCustomerInput): Promise<CustomerEntity>;
  update(
    tenantId: string,
    id: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerEntity>;
  softDelete(tenantId: string, id: string): Promise<void>;
}
