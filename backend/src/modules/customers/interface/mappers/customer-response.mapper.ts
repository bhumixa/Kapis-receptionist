import { CustomerEntity } from '../../domain/entities/customer.entity';
import { CustomerResponseDto } from '../dto/customer-response.dto';

export function toCustomerResponseDto(
  entity: CustomerEntity,
): CustomerResponseDto {
  return {
    id: entity.id,
    phoneNumber: entity.phoneNumber,
    firstName: entity.firstName,
    lastName: entity.lastName,
    email: entity.email,
    preferredLanguage: entity.preferredLanguage,
    marketingOptIn: entity.marketingOptIn,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
