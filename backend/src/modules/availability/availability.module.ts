import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { SalonModule } from '../salon/salon.module';
import { ServicesModule } from '../services/services.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AvailabilityService } from './application/availability.service';

/**
 * Milestone 6 (docs/adr/ADR-009-scheduling-engine.md) — pure computation,
 * no controller and no Prisma model of its own beyond the one narrow,
 * documented read of `appointment_services` (see `AvailabilityService`'s
 * doc comment). Deliberately has **no** dependency on `modules/appointments`
 * — `AppointmentsModule` imports *this* module (one-directional), the same
 * shape ADR-008 chose for `Employees -> Services`.
 */
@Module({
  imports: [EmployeesModule, SalonModule, ServicesModule, TenantsModule],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
