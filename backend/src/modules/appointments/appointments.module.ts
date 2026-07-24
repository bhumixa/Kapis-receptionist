import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { BookingLockModule } from '../../core/locking/booking-lock.module';
import { IdempotencyModule } from '../../core/idempotency/idempotency.module';
import { AvailabilityModule } from '../availability/availability.module';
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
 * cancellation-notice policy).
 */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    BookingLockModule,
    IdempotencyModule,
    AvailabilityModule,
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
})
export class AppointmentsModule {}
