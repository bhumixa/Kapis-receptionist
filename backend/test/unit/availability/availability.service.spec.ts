import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../../src/database/prisma.service';
import { EmployeeEntity } from '../../../src/modules/employees/domain/entities/employee.entity';
import { EmployeeService } from '../../../src/modules/employees/application/employee.service';
import { EmployeeAssignmentService } from '../../../src/modules/employees/application/employee-assignment.service';
import { WorkingHoursService } from '../../../src/modules/employees/application/working-hours.service';
import { EmployeeTimeOffService } from '../../../src/modules/employees/application/employee-time-off.service';
import { BusinessHoursService } from '../../../src/modules/salon/application/business-hours.service';
import { HolidayService } from '../../../src/modules/salon/application/holiday.service';
import { TenantSettingsService } from '../../../src/modules/tenants/application/tenant-settings.service';
import { ServiceService } from '../../../src/modules/services/application/service.service';
import { AvailabilityService } from '../../../src/modules/availability/application/availability.service';
import {
  DateRangeTooLargeException,
  ServiceNotFoundForAvailabilityException,
} from '../../../src/modules/availability/application/exceptions/availability.exceptions';
import { EMPTY_TENANT_SETTINGS_CATEGORIES } from '../../../src/modules/tenants/domain/entities/tenant-settings.entity';

const MONDAY = '2026-08-03'; // getUTCDay() === 1
const DAY_OF_WEEK = new Date(`${MONDAY}T00:00:00.000Z`).getUTCDay();

function makeEmployee(overrides: Partial<EmployeeEntity> = {}): EmployeeEntity {
  return {
    id: 'employee-1',
    tenantId: 'tenant-1',
    userId: null,
    firstName: 'Ana',
    lastName: 'Silva',
    phoneNumber: null,
    status: EmployeeStatus.ACTIVE,
    colorTag: null,
    bio: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  return {
    id: 'service-1',
    tenantId: 'tenant-1',
    categoryId: null,
    name: 'Haircut',
    description: null,
    durationMinutes: 45,
    priceCents: 8000,
    currency: 'USD',
    bufferTimeMinutes: 10,
    isActive: true,
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('AvailabilityService', () => {
  let employeeService: jest.Mocked<
    Pick<EmployeeService, 'getEmployee' | 'listEmployees'>
  >;
  let employeeAssignments: jest.Mocked<
    Pick<EmployeeAssignmentService, 'getEmployeeIdsForService'>
  >;
  let workingHoursService: jest.Mocked<
    Pick<WorkingHoursService, 'getWorkingHours'>
  >;
  let employeeTimeOffService: jest.Mocked<
    Pick<EmployeeTimeOffService, 'listTimeOff'>
  >;
  let businessHoursService: jest.Mocked<
    Pick<BusinessHoursService, 'getBusinessHours'>
  >;
  let holidayService: jest.Mocked<Pick<HolidayService, 'listHolidays'>>;
  let tenantSettingsService: jest.Mocked<
    Pick<TenantSettingsService, 'getSettings'>
  >;
  let serviceService: jest.Mocked<Pick<ServiceService, 'findByIdsForTenant'>>;
  let prisma: { appointmentService: { findMany: jest.Mock } };
  let availability: AvailabilityService;

  beforeEach(() => {
    employeeService = { getEmployee: jest.fn(), listEmployees: jest.fn() };
    employeeAssignments = { getEmployeeIdsForService: jest.fn() };
    workingHoursService = { getWorkingHours: jest.fn() };
    employeeTimeOffService = { listTimeOff: jest.fn() };
    businessHoursService = { getBusinessHours: jest.fn() };
    holidayService = { listHolidays: jest.fn() };
    tenantSettingsService = { getSettings: jest.fn() };
    serviceService = { findByIdsForTenant: jest.fn() };
    prisma = { appointmentService: { findMany: jest.fn() } };

    availability = new AvailabilityService(
      employeeService as unknown as EmployeeService,
      employeeAssignments as unknown as EmployeeAssignmentService,
      workingHoursService as unknown as WorkingHoursService,
      employeeTimeOffService as unknown as EmployeeTimeOffService,
      businessHoursService as unknown as BusinessHoursService,
      holidayService as unknown as HolidayService,
      tenantSettingsService as unknown as TenantSettingsService,
      serviceService as unknown as ServiceService,
      prisma as unknown as PrismaService,
    );

    // Salon open every day 09:00-17:00 by default.
    businessHoursService.getBusinessHours.mockResolvedValue(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        id: `bh-${dayOfWeek}`,
        tenantId: 'tenant-1',
        dayOfWeek,
        startTime: '09:00',
        endTime: '17:00',
        isClosed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    holidayService.listHolidays.mockResolvedValue([]);
    employeeTimeOffService.listTimeOff.mockResolvedValue([]);
    workingHoursService.getWorkingHours.mockResolvedValue([
      {
        id: 'wh-1',
        tenantId: 'tenant-1',
        employeeId: 'employee-1',
        dayOfWeek: DAY_OF_WEEK,
        startTime: '09:00',
        endTime: '17:00',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    prisma.appointmentService.findMany.mockResolvedValue([]);
    tenantSettingsService.getSettings.mockResolvedValue({
      id: 'settings-1',
      tenantId: 'tenant-1',
      ...EMPTY_TENANT_SETTINGS_CATEGORIES,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe('effectiveBufferMinutes', () => {
    it('returns the larger of the per-service buffer and the tenant-wide booking buffer', async () => {
      tenantSettingsService.getSettings.mockResolvedValue({
        id: 'settings-1',
        tenantId: 'tenant-1',
        ...EMPTY_TENANT_SETTINGS_CATEGORIES,
        business: { bookingBufferMinutes: 20 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        availability.effectiveBufferMinutes('tenant-1', 10),
      ).resolves.toBe(20);
      await expect(
        availability.effectiveBufferMinutes('tenant-1', 30),
      ).resolves.toBe(30);
    });

    it('defaults the tenant-wide buffer to 0 when unset', async () => {
      await expect(
        availability.effectiveBufferMinutes('tenant-1', 10),
      ).resolves.toBe(10);
    });
  });

  describe('getAvailableSlots', () => {
    it('throws ServiceNotFoundForAvailabilityException when the service does not belong to the tenant', async () => {
      serviceService.findByIdsForTenant.mockResolvedValue([]);

      await expect(
        availability.getAvailableSlots('tenant-1', {
          serviceId: 'service-1',
          dateFrom: MONDAY,
          dateTo: MONDAY,
        }),
      ).rejects.toBeInstanceOf(ServiceNotFoundForAvailabilityException);
    });

    it('rejects a date range spanning more than 31 days', async () => {
      serviceService.findByIdsForTenant.mockResolvedValue([makeService()]);

      await expect(
        availability.getAvailableSlots('tenant-1', {
          serviceId: 'service-1',
          dateFrom: '2026-08-01',
          dateTo: '2026-09-15',
        }),
      ).rejects.toBeInstanceOf(DateRangeTooLargeException);
    });

    it('returns no slots when no employee is eligible for the service', async () => {
      serviceService.findByIdsForTenant.mockResolvedValue([makeService()]);
      employeeAssignments.getEmployeeIdsForService.mockResolvedValue([]);

      const slots = await availability.getAvailableSlots('tenant-1', {
        serviceId: 'service-1',
        dateFrom: MONDAY,
        dateTo: MONDAY,
      });

      expect(slots).toEqual([]);
    });

    it('generates slots within the intersected business/working window and excludes conflicting ranges', async () => {
      serviceService.findByIdsForTenant.mockResolvedValue([makeService()]);
      employeeAssignments.getEmployeeIdsForService.mockResolvedValue([
        'employee-1',
      ]);
      employeeService.listEmployees.mockResolvedValue({
        employees: [makeEmployee()],
        total: 1,
      });
      // An existing booking blocks 09:00-10:00 (incl. buffer) that day.
      prisma.appointmentService.findMany.mockResolvedValue([
        {
          startTime: new Date(`${MONDAY}T09:00:00.000Z`),
          blockedUntil: new Date(`${MONDAY}T10:00:00.000Z`),
        },
      ]);

      const slots = await availability.getAvailableSlots('tenant-1', {
        serviceId: 'service-1',
        employeeId: 'employee-1',
        dateFrom: MONDAY,
        dateTo: MONDAY,
      });

      expect(slots.length).toBeGreaterThan(0);
      // No slot should start before the blocked range ends.
      for (const slot of slots) {
        expect(slot.startTime.getTime()).toBeGreaterThanOrEqual(
          new Date(`${MONDAY}T10:00:00.000Z`).getTime(),
        );
      }
      // Every slot must fit within business hours (09:00-17:00) including the 45-minute duration.
      for (const slot of slots) {
        expect(slot.endTime.getTime()).toBeLessThanOrEqual(
          new Date(`${MONDAY}T17:00:00.000Z`).getTime(),
        );
      }
    });

    it('excludes a day entirely when it is a tenant-wide holiday', async () => {
      serviceService.findByIdsForTenant.mockResolvedValue([makeService()]);
      employeeAssignments.getEmployeeIdsForService.mockResolvedValue([
        'employee-1',
      ]);
      employeeService.listEmployees.mockResolvedValue({
        employees: [makeEmployee()],
        total: 1,
      });
      holidayService.listHolidays.mockResolvedValue([
        {
          id: 'holiday-1',
          tenantId: 'tenant-1',
          date: MONDAY,
          reason: 'Public holiday',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const slots = await availability.getAvailableSlots('tenant-1', {
        serviceId: 'service-1',
        dateFrom: MONDAY,
        dateTo: MONDAY,
      });

      expect(slots).toEqual([]);
    });

    it('excludes a day the employee is on approved time off', async () => {
      serviceService.findByIdsForTenant.mockResolvedValue([makeService()]);
      employeeAssignments.getEmployeeIdsForService.mockResolvedValue([
        'employee-1',
      ]);
      employeeService.listEmployees.mockResolvedValue({
        employees: [makeEmployee()],
        total: 1,
      });
      employeeTimeOffService.listTimeOff.mockResolvedValue([
        {
          id: 'timeoff-1',
          tenantId: 'tenant-1',
          employeeId: 'employee-1',
          startDate: MONDAY,
          endDate: MONDAY,
          reason: 'Vacation',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const slots = await availability.getAvailableSlots('tenant-1', {
        serviceId: 'service-1',
        dateFrom: MONDAY,
        dateTo: MONDAY,
      });

      expect(slots).toEqual([]);
    });
  });

  describe('isWindowAvailable', () => {
    it('returns false when the employee is not ACTIVE', async () => {
      employeeService.getEmployee.mockResolvedValue(
        makeEmployee({ status: EmployeeStatus.ON_LEAVE }),
      );

      const result = await availability.isWindowAvailable(
        'tenant-1',
        'employee-1',
        new Date(`${MONDAY}T10:00:00.000Z`),
        new Date(`${MONDAY}T10:45:00.000Z`),
        10,
      );

      expect(result).toBe(false);
    });

    it('returns false for a window outside working hours', async () => {
      employeeService.getEmployee.mockResolvedValue(makeEmployee());

      const result = await availability.isWindowAvailable(
        'tenant-1',
        'employee-1',
        new Date(`${MONDAY}T18:00:00.000Z`),
        new Date(`${MONDAY}T18:45:00.000Z`),
        10,
      );

      expect(result).toBe(false);
    });

    it('returns false when the window overlaps an existing blocking range', async () => {
      employeeService.getEmployee.mockResolvedValue(makeEmployee());
      prisma.appointmentService.findMany.mockResolvedValue([
        {
          startTime: new Date(`${MONDAY}T10:00:00.000Z`),
          blockedUntil: new Date(`${MONDAY}T11:00:00.000Z`),
        },
      ]);

      const result = await availability.isWindowAvailable(
        'tenant-1',
        'employee-1',
        new Date(`${MONDAY}T10:30:00.000Z`),
        new Date(`${MONDAY}T11:15:00.000Z`),
        10,
      );

      expect(result).toBe(false);
    });

    it('returns true for a valid, non-conflicting window', async () => {
      employeeService.getEmployee.mockResolvedValue(makeEmployee());

      const result = await availability.isWindowAvailable(
        'tenant-1',
        'employee-1',
        new Date(`${MONDAY}T10:00:00.000Z`),
        new Date(`${MONDAY}T10:45:00.000Z`),
        10,
      );

      expect(result).toBe(true);
    });
  });
});
