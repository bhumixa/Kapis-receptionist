import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { CUSTOMER_REPOSITORY } from './domain/ports/customer-repository.port';
import { CustomerService } from './application/customer.service';
import { PrismaCustomerRepository } from './infrastructure/prisma-customer.repository';
import { CustomersController } from './interface/customers.controller';

/**
 * Milestone 6's `Customers` module (docs/adr/ADR-009-scheduling-engine.md)
 * — deferred out of Milestone 5 (docs/adr/ADR-008-workforce-and-service-
 * catalog.md), picked up now since Appointments needs it. Scoped down to
 * `Customer` CRUD only — no `CustomerTag`/`CustomerNote`/`CustomerPreference`
 * this milestone (not requested).
 */
@Module({
  imports: [CoreModule, AuthModule],
  controllers: [CustomersController],
  providers: [
    CustomerService,
    { provide: CUSTOMER_REPOSITORY, useClass: PrismaCustomerRepository },
  ],
  exports: [CustomerService],
})
export class CustomersModule {}
