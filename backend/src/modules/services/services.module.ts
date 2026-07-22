import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { SERVICE_CATEGORY_REPOSITORY } from './domain/ports/service-category-repository.port';
import { SERVICE_REPOSITORY } from './domain/ports/service-repository.port';
import { ServiceCategoryService } from './application/service-category.service';
import { ServiceService } from './application/service.service';
import { PrismaServiceCategoryRepository } from './infrastructure/prisma-service-category.repository';
import { PrismaServiceRepository } from './infrastructure/prisma-service.repository';
import { ServiceCategoriesController } from './interface/service-categories.controller';
import { ServicesController } from './interface/services.controller';

/**
 * Milestone 5's `Services` module (docs/SERVICE_ARCHITECTURE.md,
 * docs/adr/ADR-008-workforce-and-service-catalog.md) — `ServiceCategory` and
 * `Service` only. Deliberately has **no** dependency on `modules/employees`
 * (one-directional: Employees → Services, ADR-008 decision #3) so the two
 * modules' dependency graph stays a DAG — exports `ServiceService` for
 * `EmployeesModule` to validate/read service data through.
 */
@Module({
  imports: [CoreModule, AuthModule],
  controllers: [ServiceCategoriesController, ServicesController],
  providers: [
    ServiceCategoryService,
    ServiceService,
    {
      provide: SERVICE_CATEGORY_REPOSITORY,
      useClass: PrismaServiceCategoryRepository,
    },
    { provide: SERVICE_REPOSITORY, useClass: PrismaServiceRepository },
  ],
  exports: [ServiceCategoryService, ServiceService],
})
export class ServicesModule {}
