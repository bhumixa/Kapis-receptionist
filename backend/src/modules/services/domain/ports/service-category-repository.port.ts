import { ServiceCategoryEntity } from '../entities/service-category.entity';

export const SERVICE_CATEGORY_REPOSITORY = Symbol(
  'SERVICE_CATEGORY_REPOSITORY',
);

export interface CreateServiceCategoryInput {
  name: string;
  displayOrder?: number;
}

export interface UpdateServiceCategoryInput {
  name?: string;
  displayOrder?: number;
}

export interface ServiceCategoryRepositoryPort {
  findAllForTenant(tenantId: string): Promise<ServiceCategoryEntity[]>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<ServiceCategoryEntity | null>;
  create(
    tenantId: string,
    input: CreateServiceCategoryInput,
  ): Promise<ServiceCategoryEntity>;
  update(
    tenantId: string,
    id: string,
    input: UpdateServiceCategoryInput,
  ): Promise<ServiceCategoryEntity>;
  /** Soft delete (`deletedAt`) — services referencing this category are un-categorized via `onDelete: SetNull`'s FK, not deleted. */
  softDelete(tenantId: string, id: string): Promise<void>;
}
