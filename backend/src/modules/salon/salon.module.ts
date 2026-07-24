import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SALON_PROFILE_REPOSITORY } from './domain/ports/salon-profile-repository.port';
import { BUSINESS_HOURS_REPOSITORY } from './domain/ports/business-hours-repository.port';
import { HOLIDAY_REPOSITORY } from './domain/ports/holiday-repository.port';
import { SalonProfileService } from './application/salon-profile.service';
import { BusinessHoursService } from './application/business-hours.service';
import { HolidayService } from './application/holiday.service';
import { PrismaSalonProfileRepository } from './infrastructure/prisma-salon-profile.repository';
import { PrismaBusinessHoursRepository } from './infrastructure/prisma-business-hours.repository';
import { PrismaHolidayRepository } from './infrastructure/prisma-holiday.repository';
import { SalonProfileController } from './interface/salon-profile.controller';
import { SalonBusinessHoursController } from './interface/salon-business-hours.controller';
import { SalonHolidaysController } from './interface/salon-holidays.controller';

/**
 * Milestone 4's `Salon` module (docs/SALON_ARCHITECTURE.md, docs/adr/
 * ADR-007-salon-management.md) — salon business profile, branding,
 * business hours, and holidays only. Deliberately excludes Employees,
 * Services, Customers, Scheduling (a future milestone's scope).
 *
 * Imports `TenantsModule` for its exported `TenantService` — `SalonProfile
 * Service` composes `Tenant`'s existing identity fields with this module's
 * own `SalonProfile` satellite table through that public application
 * service only, never Tenant's Prisma model directly (module-boundary
 * rule, SYSTEM_ARCHITECTURE.md Section 2.3). No circular dependency: unlike
 * `TenantsModule`/`CoreModule`/`AuthModule`'s genuine 3-way cycle, nothing
 * imports `SalonModule` back.
 */
@Module({
  imports: [CoreModule, AuthModule, TenantsModule],
  controllers: [
    SalonProfileController,
    SalonBusinessHoursController,
    SalonHolidaysController,
  ],
  providers: [
    SalonProfileService,
    BusinessHoursService,
    HolidayService,
    {
      provide: SALON_PROFILE_REPOSITORY,
      useClass: PrismaSalonProfileRepository,
    },
    {
      provide: BUSINESS_HOURS_REPOSITORY,
      useClass: PrismaBusinessHoursRepository,
    },
    { provide: HOLIDAY_REPOSITORY, useClass: PrismaHolidayRepository },
  ],
  // Milestone 6 (docs/adr/ADR-009-scheduling-engine.md): `modules/
  // availability` needs `BusinessHoursService` (salon-wide open hours) and
  // `HolidayService` (tenant-wide closures) as inputs to slot computation —
  // this module's first cross-module consumer.
  exports: [BusinessHoursService, HolidayService],
})
export class SalonModule {}
