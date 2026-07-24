import { Injectable } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  addMinutes,
  combineDateAndTime,
  toDateStr,
} from '../../../common/utils/scheduling-date.util';
import { readNumberSetting } from '../../../common/utils/json-settings.util';
import { EmployeeEntity } from '../../employees/domain/entities/employee.entity';
import { EmployeeService } from '../../employees/application/employee.service';
import { EmployeeAssignmentService } from '../../employees/application/employee-assignment.service';
import { WorkingHoursService } from '../../employees/application/working-hours.service';
import { EmployeeTimeOffService } from '../../employees/application/employee-time-off.service';
import { WorkingHoursEntity } from '../../employees/domain/entities/working-hours.entity';
import { EmployeeTimeOffEntity } from '../../employees/domain/entities/employee-time-off.entity';
import { BusinessHoursService } from '../../salon/application/business-hours.service';
import { HolidayService } from '../../salon/application/holiday.service';
import { BusinessHoursEntity } from '../../salon/domain/entities/business-hours.entity';
import { HolidayEntity } from '../../salon/domain/entities/holiday.entity';
import { TenantSettingsService } from '../../tenants/application/tenant-settings.service';
import { ServiceService } from '../../services/application/service.service';
import {
  AvailabilitySlotEntity,
  WorkingWindow,
} from '../domain/entities/availability-slot.entity';
import {
  DateRangeTooLargeException,
  ServiceNotFoundForAvailabilityException,
} from './exceptions/availability.exceptions';

const SLOT_GRANULARITY_MINUTES = 15;
const MAX_DATE_RANGE_DAYS = 31;

export interface GetAvailableSlotsInput {
  serviceId: string;
  employeeId?: string;
  dateFrom: string;
  dateTo: string;
}

interface BlockingRange {
  start: Date;
  end: Date;
}

/**
 * Computes bookable time slots (FR-11, docs/SCHEDULING_ARCHITECTURE.md) —
 * the engine both `GET /appointments/availability` and `modules/
 * appointments`' own booking-time validation depend on. Owns no persistence
 * of its own; reads `Employee`/`WorkingHours`/`EmployeeTimeOff` (`modules/
 * employees`), `BusinessHours`/`Holiday` (`modules/salon`), `TenantSettings`
 * (`modules/tenants`), and `Service` (`modules/services`) through each
 * module's exported public application service — never their Prisma models
 * directly (module-boundary rule, SYSTEM_ARCHITECTURE.md Section 2.3).
 *
 * Exactly one narrow, documented exception: reads `appointment_services`
 * directly via the shared `PrismaService` rather than importing
 * `modules/appointments`. SYSTEM_ARCHITECTURE.md's own module-dependency
 * graph lists a genuine two-way need (`Availability -> ... Appointments`
 * *and* `Appointments -> ... Availability`) — the same shape ADR-008 hit
 * for `Employees<->Services` and resolved by picking one direction. Here,
 * `modules/appointments` imports `AvailabilityModule` (it needs slot
 * computation to validate a booking); the reverse import would recreate the
 * cycle, so this module reads the one table it needs read-only, the same
 * treatment `EmployeeService.assertUserLinkable` already gives `User` when
 * no owning module can be cleanly depended on (docs/adr/ADR-008 precedent).
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly employeeAssignments: EmployeeAssignmentService,
    private readonly workingHoursService: WorkingHoursService,
    private readonly employeeTimeOffService: EmployeeTimeOffService,
    private readonly businessHoursService: BusinessHoursService,
    private readonly holidayService: HolidayService,
    private readonly tenantSettingsService: TenantSettingsService,
    private readonly serviceService: ServiceService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Effective trailing buffer after an appointment (docs/SCHEDULING_
   * ARCHITECTURE.md's buffer-composition rule, ADR-009): `max` of the
   * per-service cleanup buffer and the tenant-wide minimum-gap policy — the
   * first real read of the dormant `TenantSettings.business` namespace.
   */
  async effectiveBufferMinutes(
    tenantId: string,
    serviceBufferMinutes: number,
  ): Promise<number> {
    const settings = await this.tenantSettingsService.getSettings(tenantId);
    const tenantBuffer = readNumberSetting(
      settings.business,
      'bookingBufferMinutes',
      0,
    );
    return Math.max(serviceBufferMinutes, tenantBuffer);
  }

  async getAvailableSlots(
    tenantId: string,
    input: GetAvailableSlotsInput,
  ): Promise<AvailabilitySlotEntity[]> {
    assertDateRangeWithinCap(input.dateFrom, input.dateTo);

    const [service] = await this.serviceService.findByIdsForTenant(tenantId, [
      input.serviceId,
    ]);
    if (!service) {
      throw new ServiceNotFoundForAvailabilityException();
    }

    const employees = await this.getEligibleActiveEmployees(
      tenantId,
      input.serviceId,
      input.employeeId,
    );
    if (employees.length === 0) {
      return [];
    }

    const bufferMinutes = await this.effectiveBufferMinutes(
      tenantId,
      service.bufferTimeMinutes,
    );

    const [businessHours, holidays] = await Promise.all([
      this.businessHoursService.getBusinessHours(tenantId),
      this.holidayService.listHolidays(tenantId),
    ]);

    const dateFromDate = combineDateAndTime(input.dateFrom, '00:00');
    const dateToDate = combineDateAndTime(input.dateTo, '00:00');
    const rangeEndExclusive = addMinutes(dateToDate, 24 * 60);

    const slots: AvailabilitySlotEntity[] = [];

    for (const employee of employees) {
      const [workingHours, timeOff, blockingRanges] = await Promise.all([
        this.workingHoursService.getWorkingHours(tenantId, employee.id),
        this.employeeTimeOffService.listTimeOff(tenantId, employee.id),
        this.getBlockingRanges(
          tenantId,
          employee.id,
          dateFromDate,
          rangeEndExclusive,
        ),
      ]);

      for (
        let cursor = new Date(dateFromDate);
        cursor <= dateToDate;
        cursor = addMinutes(cursor, 24 * 60)
      ) {
        const dateStr = toDateStr(cursor);
        const dayOfWeek = cursor.getUTCDay();

        const windows = this.getWorkingWindowsForDate(
          employee,
          dateStr,
          dayOfWeek,
          businessHours,
          holidays,
          timeOff,
          workingHours,
        );

        for (const window of windows) {
          for (
            let slotStart = new Date(window.start);
            addMinutes(slotStart, service.durationMinutes) <= window.end;
            slotStart = addMinutes(slotStart, SLOT_GRANULARITY_MINUTES)
          ) {
            const slotEnd = addMinutes(slotStart, service.durationMinutes);
            const slotBlockedUntil = addMinutes(slotEnd, bufferMinutes);
            const conflicts = blockingRanges.some(
              (range) =>
                slotStart < range.end && range.start < slotBlockedUntil,
            );
            if (!conflicts) {
              slots.push({
                employeeId: employee.id,
                employeeName: `${employee.firstName} ${employee.lastName}`,
                startTime: slotStart,
                endTime: slotEnd,
              });
            }
          }
        }
      }
    }

    return slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  /**
   * Validates one specific candidate `[startTime, endTime)` window for one
   * employee — used by `modules/appointments` at booking/reschedule time
   * (never trusting a prior `GET /appointments/availability` call, per
   * API_SPECIFICATION.md Section 10). Checks both working-hours compliance
   * (business hours, working hours, holidays, time off) and absence of an
   * existing conflicting booking — the *same* two conditions
   * `getAvailableSlots` already composes, applied to one exact window
   * instead of a generated candidate grid.
   */
  async isWindowAvailable(
    tenantId: string,
    employeeId: string,
    startTime: Date,
    endTime: Date,
    bufferMinutes: number,
  ): Promise<boolean> {
    const employee = await this.employeeService
      .getEmployee(tenantId, employeeId)
      .catch(() => null);
    if (!employee || employee.status !== EmployeeStatus.ACTIVE) {
      return false;
    }

    const dateStr = toDateStr(startTime);
    const dayOfWeek = startTime.getUTCDay();

    const [businessHours, holidays, workingHours, timeOff, blockingRanges] =
      await Promise.all([
        this.businessHoursService.getBusinessHours(tenantId),
        this.holidayService.listHolidays(tenantId),
        this.workingHoursService.getWorkingHours(tenantId, employeeId),
        this.employeeTimeOffService.listTimeOff(tenantId, employeeId),
        this.getBlockingRanges(tenantId, employeeId, startTime, endTime),
      ]);

    const windows = this.getWorkingWindowsForDate(
      employee,
      dateStr,
      dayOfWeek,
      businessHours,
      holidays,
      timeOff,
      workingHours,
    );
    const withinWindow = windows.some(
      (window) => startTime >= window.start && endTime <= window.end,
    );
    if (!withinWindow) {
      return false;
    }

    const blockedUntil = addMinutes(endTime, bufferMinutes);
    const conflicts = blockingRanges.some(
      (range) => startTime < range.end && range.start < blockedUntil,
    );
    return !conflicts;
  }

  private async getEligibleActiveEmployees(
    tenantId: string,
    serviceId: string,
    employeeIdFilter?: string,
  ): Promise<EmployeeEntity[]> {
    const eligibleIds = await this.employeeAssignments.getEmployeeIdsForService(
      tenantId,
      serviceId,
    );
    if (eligibleIds.length === 0) {
      return [];
    }

    const idsIn = employeeIdFilter
      ? eligibleIds.filter((id) => id === employeeIdFilter)
      : eligibleIds;
    if (idsIn.length === 0) {
      return [];
    }

    const { employees } = await this.employeeService.listEmployees(tenantId, {
      status: EmployeeStatus.ACTIVE,
      employeeIdsIn: idsIn,
      sortField: 'firstName',
      sortDirection: 'asc',
      page: 1,
      limit: idsIn.length,
    });
    return employees;
  }

  private getWorkingWindowsForDate(
    employee: EmployeeEntity,
    dateStr: string,
    dayOfWeek: number,
    businessHours: BusinessHoursEntity[],
    holidays: HolidayEntity[],
    timeOff: EmployeeTimeOffEntity[],
    workingHours: WorkingHoursEntity[],
  ): WorkingWindow[] {
    const isHoliday = holidays.some((holiday) => holiday.date === dateStr);
    if (isHoliday) {
      return [];
    }

    const onLeave = timeOff.some(
      (entry) => dateStr >= entry.startDate && dateStr <= entry.endDate,
    );
    if (onLeave) {
      return [];
    }

    const businessDay = businessHours.find(
      (entry) => entry.dayOfWeek === dayOfWeek,
    );
    if (!businessDay || businessDay.isClosed) {
      return [];
    }

    const businessWindow: WorkingWindow = {
      start: combineDateAndTime(dateStr, businessDay.startTime),
      end: combineDateAndTime(dateStr, businessDay.endTime),
    };

    const windows: WorkingWindow[] = [];
    for (const entry of workingHours) {
      if (entry.dayOfWeek !== dayOfWeek || !entry.isActive) {
        continue;
      }
      const entryWindow: WorkingWindow = {
        start: combineDateAndTime(dateStr, entry.startTime),
        end: combineDateAndTime(dateStr, entry.endTime),
      };
      const start =
        entryWindow.start > businessWindow.start
          ? entryWindow.start
          : businessWindow.start;
      const end =
        entryWindow.end < businessWindow.end
          ? entryWindow.end
          : businessWindow.end;
      if (start < end) {
        windows.push({ start, end });
      }
    }
    return windows;
  }

  /** Employee's existing blocking `AppointmentService` ranges overlapping `[rangeStart, rangeEnd)` — see this class's doc comment for why this reads `appointment_services` directly. */
  private async getBlockingRanges(
    tenantId: string,
    employeeId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<BlockingRange[]> {
    const rows = await this.prisma.appointmentService.findMany({
      where: {
        tenantId,
        employeeId,
        isBlocking: true,
        startTime: { lt: rangeEnd },
        blockedUntil: { gt: rangeStart },
      },
      select: { startTime: true, blockedUntil: true },
    });
    return rows.map((row) => ({ start: row.startTime, end: row.blockedUntil }));
  }
}

function assertDateRangeWithinCap(dateFrom: string, dateTo: string): void {
  const from = combineDateAndTime(dateFrom, '00:00');
  const to = combineDateAndTime(dateTo, '00:00');
  const diffDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (diffDays < 0 || diffDays > MAX_DATE_RANGE_DAYS) {
    throw new DateRangeTooLargeException();
  }
}
