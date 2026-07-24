import { AppointmentStatus, EmployeeStatus, RoleName } from '@prisma/client';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../src/core/guards/rbac.exceptions';
import {
  BookingLockAcquisitionError,
  BookingLockService,
} from '../../../src/core/locking/booking-lock.service';
import { CustomerService } from '../../../src/modules/customers/application/customer.service';
import { EmployeeService } from '../../../src/modules/employees/application/employee.service';
import { EmployeeAssignmentService } from '../../../src/modules/employees/application/employee-assignment.service';
import { ServiceService } from '../../../src/modules/services/application/service.service';
import { TenantSettingsService } from '../../../src/modules/tenants/application/tenant-settings.service';
import { EMPTY_TENANT_SETTINGS_CATEGORIES } from '../../../src/modules/tenants/domain/entities/tenant-settings.entity';
import { AvailabilityService } from '../../../src/modules/availability/application/availability.service';
import { AppointmentEntity } from '../../../src/modules/appointments/domain/entities/appointment.entity';
import { AppointmentRepositoryPort } from '../../../src/modules/appointments/domain/ports/appointment-repository.port';
import { AppointmentsService } from '../../../src/modules/appointments/application/appointments.service';
import {
  EmptyServiceLinesException,
  InvalidCustomerReferenceException,
  InvalidEmployeeReferenceException,
  InvalidServiceReferenceException,
  InvalidStatusTransitionException,
  SlotNoLongerAvailableException,
  StaffScopeForbiddenException,
} from '../../../src/modules/appointments/application/exceptions/appointment.exceptions';

const ownerActor = {
  sub: 'user-owner',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};
const staffActor = {
  sub: 'user-staff',
  email: 'staff@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.STAFF],
};

function makeCustomer() {
  return {
    id: 'customer-1',
    tenantId: 'tenant-1',
    phoneNumber: '+5511999999999',
    firstName: 'Sofia',
    lastName: 'Reyes',
    email: null,
    preferredLanguage: null,
    marketingOptIn: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeEmployee(overrides: Record<string, unknown> = {}) {
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
    createdAt: new Date(),
    updatedAt: new Date(),
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeAppointment(
  overrides: Partial<AppointmentEntity> = {},
): AppointmentEntity {
  return {
    id: 'appointment-1',
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    employeeId: 'employee-1',
    status: AppointmentStatus.CONFIRMED,
    startTime: new Date('2026-08-03T14:00:00Z'),
    endTime: new Date('2026-08-03T14:45:00Z'),
    totalPriceCents: 8000,
    currency: 'USD',
    notes: null,
    cancellationReason: null,
    cancelledAt: null,
    rescheduledFromAppointmentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    services: [
      {
        id: 'line-1',
        serviceId: 'service-1',
        employeeId: 'employee-1',
        serviceNameSnapshot: 'Haircut',
        durationMinutesSnapshot: 45,
        priceCentsSnapshot: 8000,
        bufferMinutesSnapshot: 10,
        sequenceOrder: 0,
        startTime: new Date('2026-08-03T14:00:00Z'),
        endTime: new Date('2026-08-03T14:45:00Z'),
        blockedUntil: new Date('2026-08-03T14:55:00Z'),
        isBlocking: true,
      },
    ],
    ...overrides,
  };
}

describe('AppointmentsService', () => {
  let repo: jest.Mocked<AppointmentRepositoryPort>;
  let availability: jest.Mocked<
    Pick<AvailabilityService, 'isWindowAvailable' | 'effectiveBufferMinutes'>
  >;
  let bookingLock: jest.Mocked<Pick<BookingLockService, 'acquire' | 'release'>>;
  let customers: jest.Mocked<Pick<CustomerService, 'findByIdsForTenant'>>;
  let employeeService: jest.Mocked<
    Pick<EmployeeService, 'getEmployee' | 'findByUserId'>
  >;
  let employeeAssignments: jest.Mocked<
    Pick<EmployeeAssignmentService, 'getServiceIdsForEmployee'>
  >;
  let services: jest.Mocked<Pick<ServiceService, 'findByIdsForTenant'>>;
  let tenantSettings: jest.Mocked<Pick<TenantSettingsService, 'getSettings'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let appointmentsService: AppointmentsService;

  beforeEach(() => {
    repo = {
      findList: jest.fn(),
      findByIdForTenant: jest.fn(),
      create: jest.fn(),
      updateNotes: jest.fn(),
      cancel: jest.fn(),
      reschedule: jest.fn(),
      softDelete: jest.fn(),
    };
    availability = {
      isWindowAvailable: jest.fn().mockResolvedValue(true),
      effectiveBufferMinutes: jest.fn().mockResolvedValue(10),
    };
    bookingLock = {
      acquire: jest.fn().mockResolvedValue([{ key: 'lock:x', token: 't' }]),
      release: jest.fn().mockResolvedValue(undefined),
    };
    customers = {
      findByIdsForTenant: jest.fn().mockResolvedValue([makeCustomer()]),
    };
    employeeService = {
      getEmployee: jest.fn().mockResolvedValue(makeEmployee()),
      findByUserId: jest.fn(),
    };
    employeeAssignments = {
      getServiceIdsForEmployee: jest.fn().mockResolvedValue(['service-1']),
    };
    services = {
      findByIdsForTenant: jest.fn().mockResolvedValue([makeService()]),
    };
    tenantSettings = {
      getSettings: jest.fn().mockResolvedValue({
        id: 'settings-1',
        tenantId: 'tenant-1',
        ...EMPTY_TENANT_SETTINGS_CATEGORIES,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    auditLog = { record: jest.fn() };

    appointmentsService = new AppointmentsService(
      repo,
      availability as unknown as AvailabilityService,
      bookingLock as unknown as BookingLockService,
      customers as unknown as CustomerService,
      employeeService as unknown as EmployeeService,
      employeeAssignments as unknown as EmployeeAssignmentService,
      services as unknown as ServiceService,
      tenantSettings as unknown as TenantSettingsService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('createAppointment', () => {
    const request = {
      customerId: 'customer-1',
      startTime: new Date('2026-08-03T14:00:00Z'),
      services: [{ serviceId: 'service-1', employeeId: 'employee-1' }],
    };

    it('creates an appointment, acquires/releases the booking lock, and records an audit entry', async () => {
      repo.create.mockResolvedValue(makeAppointment());

      const result = await appointmentsService.createAppointment(
        'tenant-1',
        ownerActor,
        request,
      );

      expect(result.id).toBe('appointment-1');
      expect(bookingLock.acquire).toHaveBeenCalledWith('tenant-1', [
        'employee-1',
      ]);
      expect(bookingLock.release).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPOINTMENT_CREATED' }),
      );
    });

    it('rejects an empty services array', async () => {
      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, {
          ...request,
          services: [],
        }),
      ).rejects.toBeInstanceOf(EmptyServiceLinesException);
    });

    it('rejects a customerId that does not belong to the tenant', async () => {
      customers.findByIdsForTenant.mockResolvedValue([]);

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(InvalidCustomerReferenceException);
    });

    it('rejects a serviceId that does not belong to the tenant', async () => {
      services.findByIdsForTenant.mockResolvedValue([]);

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(InvalidServiceReferenceException);
    });

    it('rejects an employeeId that does not exist in the tenant', async () => {
      employeeService.getEmployee.mockRejectedValue(
        new TenantResourceNotFoundException(),
      );

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(InvalidEmployeeReferenceException);
    });

    it('rejects an employee who is not ACTIVE', async () => {
      employeeService.getEmployee.mockResolvedValue(
        makeEmployee({ status: EmployeeStatus.ON_LEAVE }),
      );

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(InvalidEmployeeReferenceException);
    });

    it('rejects an employee not eligible for the requested service', async () => {
      employeeAssignments.getServiceIdsForEmployee.mockResolvedValue([
        'some-other-service',
      ]);

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(InvalidEmployeeReferenceException);
    });

    it('throws SlotNoLongerAvailableException and releases the lock when the pre-flight availability check fails', async () => {
      availability.isWindowAvailable.mockResolvedValue(false);

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(SlotNoLongerAvailableException);
      expect(bookingLock.release).toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('throws SlotNoLongerAvailableException when the Redis lock is already held', async () => {
      bookingLock.acquire.mockRejectedValue(
        new BookingLockAcquisitionError('employee-1'),
      );

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(SlotNoLongerAvailableException);
    });

    it('translates a database EXCLUDE-constraint violation into SlotNoLongerAvailableException', async () => {
      repo.create.mockRejectedValue(
        new Error(
          'duplicate key value violates exclusion constraint "excl_appointment_services_employee_time"',
        ),
      );

      await expect(
        appointmentsService.createAppointment('tenant-1', ownerActor, request),
      ).rejects.toBeInstanceOf(SlotNoLongerAvailableException);
      expect(bookingLock.release).toHaveBeenCalled();
    });
  });

  describe('cancelAppointment', () => {
    it('rejects cancelling an already-cancelled appointment', async () => {
      repo.findByIdForTenant.mockResolvedValue(
        makeAppointment({ status: AppointmentStatus.CANCELLED }),
      );

      await expect(
        appointmentsService.cancelAppointment(
          'tenant-1',
          'appointment-1',
          ownerActor,
          undefined,
        ),
      ).rejects.toBeInstanceOf(InvalidStatusTransitionException);
      expect(repo.cancel).not.toHaveBeenCalled();
    });

    it('cancels a confirmed appointment and returns a late-notice warning when within the policy window', async () => {
      const soon = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      repo.findByIdForTenant.mockResolvedValue(
        makeAppointment({ startTime: soon }),
      );
      repo.cancel.mockResolvedValue(
        makeAppointment({
          status: AppointmentStatus.CANCELLED,
          startTime: soon,
        }),
      );

      const result = await appointmentsService.cancelAppointment(
        'tenant-1',
        'appointment-1',
        ownerActor,
        'Customer requested.',
      );

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPOINTMENT_CANCELLED' }),
      );
    });

    it('returns no warning when well outside the cancellation notice window', async () => {
      const farFuture = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours from now
      repo.findByIdForTenant.mockResolvedValue(
        makeAppointment({ startTime: farFuture }),
      );
      repo.cancel.mockResolvedValue(
        makeAppointment({ status: AppointmentStatus.CANCELLED }),
      );

      const result = await appointmentsService.cancelAppointment(
        'tenant-1',
        'appointment-1',
        ownerActor,
        undefined,
      );

      expect(result.warnings).toEqual([]);
    });
  });

  describe('rescheduleAppointment', () => {
    it('reuses the original service/employee assignments when services is omitted', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeAppointment());
      repo.reschedule.mockResolvedValue({
        original: makeAppointment({ status: AppointmentStatus.RESCHEDULED }),
        newAppointment: makeAppointment({ id: 'appointment-2' }),
      });

      const result = await appointmentsService.rescheduleAppointment(
        'tenant-1',
        'appointment-1',
        ownerActor,
        { newStartTime: new Date('2026-08-05T10:00:00Z') },
      );

      expect(result.newAppointment.id).toBe('appointment-2');
      expect(repo.reschedule).toHaveBeenCalledWith(
        'tenant-1',
        'appointment-1',
        expect.objectContaining({ employeeId: 'employee-1' }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPOINTMENT_RESCHEDULED' }),
      );
    });

    it('rejects rescheduling an already-completed appointment', async () => {
      repo.findByIdForTenant.mockResolvedValue(
        makeAppointment({ status: AppointmentStatus.COMPLETED }),
      );

      await expect(
        appointmentsService.rescheduleAppointment(
          'tenant-1',
          'appointment-1',
          ownerActor,
          {
            newStartTime: new Date('2026-08-05T10:00:00Z'),
          },
        ),
      ).rejects.toBeInstanceOf(InvalidStatusTransitionException);
    });
  });

  describe('STAFF scoping', () => {
    it('allows STAFF to access their own appointment', async () => {
      repo.findByIdForTenant.mockResolvedValue(makeAppointment());
      employeeService.findByUserId.mockResolvedValue(
        makeEmployee({ id: 'employee-1' }),
      );

      await expect(
        appointmentsService.getAppointment(
          'tenant-1',
          'appointment-1',
          staffActor,
        ),
      ).resolves.toMatchObject({ id: 'appointment-1' });
    });

    it("forbids STAFF from accessing another employee's appointment", async () => {
      repo.findByIdForTenant.mockResolvedValue(makeAppointment());
      employeeService.findByUserId.mockResolvedValue(
        makeEmployee({ id: 'someone-else' }),
      );

      await expect(
        appointmentsService.getAppointment(
          'tenant-1',
          'appointment-1',
          staffActor,
        ),
      ).rejects.toBeInstanceOf(StaffScopeForbiddenException);
    });

    it("forces the employeeId filter to STAFF's own linked employee when listing", async () => {
      employeeService.findByUserId.mockResolvedValue(
        makeEmployee({ id: 'employee-1' }),
      );
      repo.findList.mockResolvedValue([]);

      await appointmentsService.listAppointments('tenant-1', staffActor, {
        sortDirection: 'asc',
        cursor: null,
        limit: 20,
      });

      expect(repo.findList).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ employeeId: 'employee-1' }),
      );
    });
  });
});
