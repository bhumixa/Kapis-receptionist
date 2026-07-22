import { ServiceCategoryEntity } from '../../domain/entities/service-category.entity';
import { ServiceEntity } from '../../domain/entities/service.entity';
import { ServiceCategoryResponseDto } from '../dto/service-category-response.dto';
import { ServiceResponseDto } from '../dto/service-response.dto';

export function toServiceCategoryResponseDto(
  entity: ServiceCategoryEntity,
): ServiceCategoryResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    displayOrder: entity.displayOrder,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toServiceResponseDto(
  entity: ServiceEntity,
): ServiceResponseDto {
  return {
    id: entity.id,
    categoryId: entity.categoryId,
    name: entity.name,
    description: entity.description,
    durationMinutes: entity.durationMinutes,
    priceCents: entity.priceCents,
    currency: entity.currency,
    bufferTimeMinutes: entity.bufferTimeMinutes,
    isActive: entity.isActive,
    displayOrder: entity.displayOrder,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
