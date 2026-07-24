import { Customer as PrismaCustomer } from '@prisma/client';
import { CustomerEntity } from '../../domain/entities/customer.entity';

export function toCustomerEntity(row: PrismaCustomer): CustomerEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phoneNumber: row.phoneNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    preferredLanguage: row.preferredLanguage,
    marketingOptIn: row.marketingOptIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
