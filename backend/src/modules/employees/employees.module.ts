import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { ServicesModule } from '../services/services.module';
import { EMPLOYEE_REPOSITORY } from './domain/ports/employee-repository.port';
import { EMPLOYEE_SERVICE_REPOSITORY } from './domain/ports/employee-service-repository.port';
import { EMPLOYEE_TIME_OFF_REPOSITORY } from './domain/ports/employee-time-off-repository.port';
import { WORKING_HOURS_REPOSITORY } from './domain/ports/working-hours-repository.port';
import { EmployeeAssignmentService } from './application/employee-assignment.service';
import { EmployeeTimeOffService } from './application/employee-time-off.service';
import { EmployeeService } from './application/employee.service';
import { WorkingHoursService } from './application/working-hours.service';
import { PrismaEmployeeServiceRepository } from './infrastructure/prisma-employee-service.repository';
import { PrismaEmployeeTimeOffRepository } from './infrastructure/prisma-employee-time-off.repository';
import { PrismaEmployeeRepository } from './infrastructure/prisma-employee.repository';
import { PrismaWorkingHoursRepository } from './infrastructure/prisma-working-hours.repository';
import { EmployeeTimeOffController } from './interface/employee-time-off.controller';
import { EmployeeWorkingHoursController } from './interface/employee-working-hours.controller';
import { EmployeesController } from './interface/employees.controller';

/**
 * Milestone 5's `Employees` module (docs/WORKFORCE_ARCHITECTURE.md,
 * docs/adr/ADR-008-workforce-and-service-catalog.md) — `Employee`,
 * `WorkingHours`, `EmployeeTimeOff`, and the `EmployeeService` junction.
 * Imports `ServicesModule` (one-directional: Employees → Services, ADR-008
 * decision #3) to validate `serviceIds` and read service data for
 * assignment — `ServicesModule` never imports this module back, keeping
 * the dependency graph a DAG.
 */
@Module({
  imports: [CoreModule, AuthModule, ServicesModule],
  controllers: [
    EmployeesController,
    EmployeeWorkingHoursController,
    EmployeeTimeOffController,
  ],
  providers: [
    EmployeeService,
    WorkingHoursService,
    EmployeeTimeOffService,
    EmployeeAssignmentService,
    { provide: EMPLOYEE_REPOSITORY, useClass: PrismaEmployeeRepository },
    {
      provide: WORKING_HOURS_REPOSITORY,
      useClass: PrismaWorkingHoursRepository,
    },
    {
      provide: EMPLOYEE_TIME_OFF_REPOSITORY,
      useClass: PrismaEmployeeTimeOffRepository,
    },
    {
      provide: EMPLOYEE_SERVICE_REPOSITORY,
      useClass: PrismaEmployeeServiceRepository,
    },
  ],
})
export class EmployeesModule {}
