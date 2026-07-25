import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { BookingLockModule } from '../../core/locking/booking-lock.module';
import { IdempotencyModule } from '../../core/idempotency/idempotency.module';
import { AvailabilityModule } from '../availability/availability.module';
import { BillingModule } from '../billing/billing.module';
import { CustomersModule } from '../customers/customers.module';
import { EmployeesModule } from '../employees/employees.module';
import { ServicesModule } from '../services/services.module';
import { TenantsModule } from '../tenants/tenants.module';
import { APPOINTMENT_REPOSITORY } from './domain/ports/appointment-repository.port';
import { AppointmentsService } from './application/appointments.service';
import { PrismaAppointmentRepository } from './infrastructure/prisma-appointment.repository';
import { AppointmentsController } from './interface/appointments.controller';

/**
 * Milestone 6's `Appointments` module (docs/adr/ADR-009-scheduling-engine.md)
 * — the platform's highest-stakes module. Imports `AvailabilityModule`
 * (one-directional: `Appointments -> Availability`, mirroring ADR-008's
 * `Employees -> Services` precedent for the same kind of two-way need in
 * SYSTEM_ARCHITECTURE.md's original module graph) plus every domain module
 * whose data a booking references: `CustomersModule`, `EmployeesModule`,
 * `ServicesModule`, `TenantsModule` (for `TenantSettingsService`'s
 * cancellation-notice policy). Milestone 9 adds `BillingModule` (for
 * `EntitlementService.assertWithinLimit(APPOINTMENT_LIMIT, ...)` in
 * `AppointmentsService.createAppointment`/`createAppointmentForAi`) —
 * one-directional, same reasoning as `EmployeesModule`'s own Milestone 9
 * addition (docs/FEATURE_ENTITLEMENTS.md).
 */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    BookingLockModule,
    IdempotencyModule,
    AvailabilityModule,
    BillingModule,
    CustomersModule,
    EmployeesModule,
    ServicesModule,
    TenantsModule,
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    { provide: APPOINTMENT_REPOSITORY, useClass: PrismaAppointmentRepository },
  ],
  // Milestone 8 (docs/adr/ADR-011-ai-receptionist.md): `modules/ai`'s
  // `ToolExecutorService` calls `createAppointmentForAi`/
  // `rescheduleAppointmentForAi`/`cancelAppointmentForAi` directly — the
  // same in-process reuse this module's own doc comment already commits to
  // (SYSTEM_ARCHITECTURE.md 5.3), not a duplicated booking implementation.
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
