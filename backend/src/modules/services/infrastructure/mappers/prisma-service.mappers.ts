import {
  ServiceCategory as PrismaServiceCategory,
  Service as PrismaService,
} from '@prisma/client';
import { ServiceCategoryEntity } from '../../domain/entities/service-category.entity';
import { ServiceEntity } from '../../domain/entities/service.entity';

export function toServiceCategoryEntity(
  row: PrismaServiceCategory,
): ServiceCategoryEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toServiceEntity(row: PrismaService): ServiceEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    priceCents: row.priceCents,
    currency: row.currency,
    bufferTimeMinutes: row.bufferTimeMinutes,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
