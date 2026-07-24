import { Inject, Injectable } from '@nestjs/common';
import {
  ActorType,
  AppointmentStatus,
  EmployeeStatus,
  RoleName,
} from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import {
  AcquiredLock,
  BookingLockAcquisitionError,
  BookingLockService,
} from '../../../core/locking/booking-lock.service';
import { ROLE_RANK } from '../../../common/constants/rbac.constants';
import { readNumberSetting } from '../../../common/utils/json-settings.util';
import { addMinutes } from '../../../common/utils/scheduling-date.util';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { CustomerService } from '../../customers/application/customer.service';
import { EmployeeService } from '../../employees/application/employee.service';
import { EmployeeAssignmentService } from '../../employees/application/employee-assignment.service';
import { ServiceService } from '../../services/application/service.service';
import { TenantSettingsService } from '../../tenants/application/tenant-settings.service';
import { AvailabilityService } from '../../availability/application/availability.service';
import { AppointmentEntity } from '../domain/entities/appointment.entity';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentListFilter,
  type AppointmentRepositoryPort,
  type AppointmentServiceLineInput,
  type CreateAppointmentInput,
} from '../domain/ports/appointment-repository.port';
import {
  EmptyServiceLinesException,
  InvalidCustomerReferenceException,
  InvalidEmployeeReferenceException,
  InvalidServiceReferenceException,
  InvalidStatusTransitionException,
  NoUpdateFieldsProvidedException,
  SlotNoLongerAvailableException,
  StaffScopeForbiddenException,
} from './exceptions/appointment.exceptions';

export interface AppointmentServiceLineRequest {
  serviceId: string;
  employeeId: string;
}

export interface CreateAppointmentRequest {
  customerId: string;
  startTime: Date;
  services: AppointmentServiceLineRequest[];
  notes?: string | null;
}

export interface RescheduleAppointmentRequest {
  newStartTime: Date;
  services?: AppointmentServiceLineRequest[];
}

interface BuiltLine extends AppointmentServiceLineInput {
  currency: string;
}

/**
 * `GET/POST/PATCH/DELETE /appointments[/:id]`, `.../cancel`, `.../
 * reschedule` (API_SPECIFICATION.md Section 10, docs/adr/
 * ADR-009-scheduling-engine.md). The highest-stakes service in the
 * codebase — every write path here goes through the two-layer
 * conflict-prevention mechanism (Redis lock + `AvailabilityService`
 * pre-flight check + the database `EXCLUDE` constraint as final backstop).
 */
@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY)
    private readonly appointments: AppointmentRepositoryPort,
    private readonly availability: AvailabilityService,
    private readonly bookingLock: BookingLockService,
    private readonly customers: CustomerService,
    private readonly employeeService: EmployeeService,
    private readonly employeeAssignments: EmployeeAssignmentService,
    private readonly services: ServiceService,
    private readonly tenantSettings: TenantSettingsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listAppointments(
    tenantId: string,
    actor: AccessTokenPayload,
    filter: AppointmentListFilter,
  ): Promise<AppointmentEntity[]> {
    let effectiveEmployeeId = filter.employeeId;
    if (this.isStaffOnly(actor)) {
      const employee = await this.employeeService.findByUserId(
        tenantId,
        actor.sub,
      );
      // No linked Employee -> guarantee an empty result rather than
      // silently falling back to the tenant-wide list.
      effectiveEmployeeId =
        employee?.id ?? '00000000-0000-0000-0000-000000000000';
    }
    return this.appointments.findList(tenantId, {
      ...filter,
      employeeId: effectiveEmployeeId,
    });
  }

  async getAppointment(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<AppointmentEntity> {
    return this.getAppointmentForActor(tenantId, id, actor);
  }

  async createAppointment(
    tenantId: string,
    actor: AccessTokenPayload,
    request: CreateAppointmentRequest,
  ): Promise<AppointmentEntity> {
    await this.assertCustomerBelongsToTenant(tenantId, request.customerId);
    const lines = await this.buildLines(
      tenantId,
      request.startTime,
      request.services,
    );

    return this.withEmployeeLocks(tenantId, lines, async () => {
      const appointment = await this.createWithConflictHandling(
        tenantId,
        {
          customerId: request.customerId,
          employeeId: lines[0].employeeId,
          startTime: lines[0].startTime,
          endTime: lines.at(-1)!.endTime,
          totalPriceCents: sumPrice(lines),
          currency: lines[0].currency,
          notes: request.notes ?? null,
          lines,
          actorId: actor.sub,
        },
        'CREATED',
      );

      await this.auditLog.record({
        action: 'APPOINTMENT_CREATED',
        entityType: 'Appointment',
        entityId: appointment.id,
        actorType: ActorType.USER,
        actorId: actor.sub,
        tenantId,
        metadata: {
          customerId: request.customerId,
          serviceCount: lines.length,
        },
      });

      return appointment;
    });
  }

  async updateNotes(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    notes: string | undefined,
  ): Promise<AppointmentEntity> {
    if (notes === undefined) {
      throw new NoUpdateFieldsProvidedException();
    }
    await this.getAppointmentForActor(tenantId, id, actor);
    const updated = await this.appointments.updateNotes(tenantId, id, notes);

    await this.auditLog.record({
      action: 'APPOINTMENT_NOTES_UPDATED',
      entityType: 'Appointment',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: {},
    });

    return updated;
  }

  async cancelAppointment(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    reason: string | undefined,
  ): Promise<{ appointment: AppointmentEntity; warnings: string[] }> {
    const current = await this.getAppointmentForActor(tenantId, id, actor);
    assertCancellableStatus(current.status, 'cancel');

    const warnings = await this.buildLateNoticeWarnings(
      tenantId,
      current.startTime,
    );

    const cancelled = await this.appointments.cancel(tenantId, id, {
      reason: reason ?? null,
      actorId: actor.sub,
    });

    await this.auditLog.record({
      action: 'APPOINTMENT_CANCELLED',
      entityType: 'Appointment',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { reason: reason ?? null },
    });

    return { appointment: cancelled, warnings };
  }

  async rescheduleAppointment(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
    request: RescheduleAppointmentRequest,
  ): Promise<{
    originalAppointment: AppointmentEntity;
    newAppointment: AppointmentEntity;
    warnings: string[];
  }> {
    const current = await this.getAppointmentForActor(tenantId, id, actor);
    assertCancellableStatus(current.status, 'reschedule');

    const warnings = await this.buildLateNoticeWarnings(
      tenantId,
      current.startTime,
    );

    const lineRequests: AppointmentServiceLineRequest[] =
      request.services ??
      current.services.map((line) => ({
        serviceId: line.serviceId,
        employeeId: line.employeeId,
      }));

    const lines = await this.buildLines(
      tenantId,
      request.newStartTime,
      lineRequests,
    );

    const { original, newAppointment } = await this.withEmployeeLocks(
      tenantId,
      lines,
      async () => {
        try {
          return await this.appointments.reschedule(tenantId, id, {
            customerId: current.customerId,
            employeeId: lines[0].employeeId,
            startTime: lines[0].startTime,
            endTime: lines.at(-1)!.endTime,
            totalPriceCents: sumPrice(lines),
            currency: lines[0].currency,
            notes: current.notes,
            lines,
            actorId: actor.sub,
          });
        } catch (error) {
          if (isExclusionConstraintViolation(error)) {
            throw new SlotNoLongerAvailableException();
          }
          throw error;
        }
      },
    );

    await this.auditLog.record({
      action: 'APPOINTMENT_RESCHEDULED',
      entityType: 'Appointment',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: {
        newAppointmentId: newAppointment.id,
        newStartTime: request.newStartTime.toISOString(),
      },
    });

    return { originalAppointment: original, newAppointment, warnings };
  }

  async deleteAppointment(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const current = await this.appointments.findByIdForTenant(tenantId, id);
    if (!current) {
      throw new TenantResourceNotFoundException();
    }

    await this.appointments.softDelete(tenantId, id);

    await this.auditLog.record({
      action: 'APPOINTMENT_DELETED',
      entityType: 'Appointment',
      entityId: id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: {},
    });
  }

  // --- Shared helpers -------------------------------------------------

  /** Acquires locks for every distinct employee involved, runs `work`, always releases — even on failure. */
  private async withEmployeeLocks<T>(
    tenantId: string,
    lines: BuiltLine[],
    work: () => Promise<T>,
  ): Promise<T> {
    const employeeIds = Array.from(
      new Set(lines.map((line) => line.employeeId)),
    );

    let locks: AcquiredLock[];
    try {
      locks = await this.bookingLock.acquire(tenantId, employeeIds);
    } catch (error) {
      if (error instanceof BookingLockAcquisitionError) {
        throw new SlotNoLongerAvailableException(error.employeeId);
      }
      throw error;
    }

    try {
      for (const line of lines) {
        const available = await this.availability.isWindowAvailable(
          tenantId,
          line.employeeId,
          line.startTime,
          line.endTime,
          line.bufferMinutesSnapshot,
        );
        if (!available) {
          throw new SlotNoLongerAvailableException(line.employeeId);
        }
      }
      return await work();
    } finally {
      await this.bookingLock.release(locks);
    }
  }

  private async createWithConflictHandling(
    tenantId: string,
    input: CreateAppointmentInput,
    historyAction: 'CREATED' | 'RESCHEDULED',
  ): Promise<AppointmentEntity> {
    try {
      return await this.appointments.create(tenantId, input, historyAction);
    } catch (error) {
      if (isExclusionConstraintViolation(error)) {
        throw new SlotNoLongerAvailableException();
      }
      throw error;
    }
  }

  private async assertCustomerBelongsToTenant(
    tenantId: string,
    customerId: string,
  ): Promise<void> {
    const [customer] = await this.customers.findByIdsForTenant(tenantId, [
      customerId,
    ]);
    if (!customer) {
      throw new InvalidCustomerReferenceException(customerId);
    }
  }

  /** Validates every requested `(serviceId, employeeId)` pair and computes each line's sequential `[startTime, endTime, blockedUntil)`. */
  private async buildLines(
    tenantId: string,
    startTime: Date,
    requests: AppointmentServiceLineRequest[],
  ): Promise<BuiltLine[]> {
    if (requests.length === 0) {
      throw new EmptyServiceLinesException();
    }

    const serviceIds = requests.map((request) => request.serviceId);
    const foundServices = await this.services.findByIdsForTenant(
      tenantId,
      serviceIds,
    );
    const servicesById = new Map(
      foundServices.map((service) => [service.id, service]),
    );

    const lines: BuiltLine[] = [];
    let cursor = startTime;

    for (let index = 0; index < requests.length; index++) {
      const request = requests[index];
      const service = servicesById.get(request.serviceId);
      if (!service) {
        throw new InvalidServiceReferenceException(request.serviceId);
      }

      const employee = await this.employeeService
        .getEmployee(tenantId, request.employeeId)
        .catch(() => null);
      if (!employee) {
        throw new InvalidEmployeeReferenceException(
          request.employeeId,
          'not_found_in_tenant',
        );
      }
      if (employee.status !== EmployeeStatus.ACTIVE) {
        throw new InvalidEmployeeReferenceException(
          request.employeeId,
          'not_active',
        );
      }

      const eligibleServiceIds =
        await this.employeeAssignments.getServiceIdsForEmployee(
          tenantId,
          request.employeeId,
        );
      if (!eligibleServiceIds.includes(request.serviceId)) {
        throw new InvalidEmployeeReferenceException(
          request.employeeId,
          'not_eligible_for_service',
        );
      }

      const bufferMinutes = await this.availability.effectiveBufferMinutes(
        tenantId,
        service.bufferTimeMinutes,
      );
      const lineStart = cursor;
      const lineEnd = addMinutes(lineStart, service.durationMinutes);
      const blockedUntil = addMinutes(lineEnd, bufferMinutes);

      lines.push({
        serviceId: service.id,
        employeeId: request.employeeId,
        serviceNameSnapshot: service.name,
        durationMinutesSnapshot: service.durationMinutes,
        priceCentsSnapshot: service.priceCents,
        bufferMinutesSnapshot: bufferMinutes,
        sequenceOrder: index,
        startTime: lineStart,
        endTime: lineEnd,
        blockedUntil,
        currency: service.currency,
      });

      cursor = lineEnd;
    }

    return lines;
  }

  private async buildLateNoticeWarnings(
    tenantId: string,
    startTime: Date,
  ): Promise<string[]> {
    const settings = await this.tenantSettings.getSettings(tenantId);
    const noticeHours = readNumberSetting(
      settings.business,
      'cancellationNoticeHours',
      24,
    );
    const hoursUntilStart =
      (startTime.getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursUntilStart < noticeHours) {
      return [
        `This appointment starts within the ${noticeHours}-hour cancellation notice policy.`,
      ];
    }
    return [];
  }

  private async getAppointmentForActor(
    tenantId: string,
    id: string,
    actor: AccessTokenPayload,
  ): Promise<AppointmentEntity> {
    const appointment = await this.appointments.findByIdForTenant(tenantId, id);
    if (!appointment) {
      throw new TenantResourceNotFoundException();
    }
    await this.assertStaffCanAccess(tenantId, appointment, actor);
    return appointment;
  }

  private async assertStaffCanAccess(
    tenantId: string,
    appointment: AppointmentEntity,
    actor: AccessTokenPayload,
  ): Promise<void> {
    if (!this.isStaffOnly(actor)) {
      return;
    }
    const employee = await this.employeeService.findByUserId(
      tenantId,
      actor.sub,
    );
    const ownsAppointment =
      !!employee &&
      (appointment.employeeId === employee.id ||
        appointment.services.some((line) => line.employeeId === employee.id));
    if (!ownsAppointment) {
      throw new StaffScopeForbiddenException();
    }
  }

  private isStaffOnly(actor: AccessTokenPayload): boolean {
    const maxRank = Math.max(0, ...actor.roles.map((role) => ROLE_RANK[role]));
    return maxRank <= ROLE_RANK[RoleName.STAFF];
  }
}

function sumPrice(lines: BuiltLine[]): number {
  return lines.reduce((sum, line) => sum + line.priceCentsSnapshot, 0);
}

function assertCancellableStatus(
  status: AppointmentStatus,
  action: 'cancel' | 'reschedule',
): void {
  if (
    status !== AppointmentStatus.PENDING &&
    status !== AppointmentStatus.CONFIRMED
  ) {
    throw new InvalidStatusTransitionException(
      `Cannot ${action} an appointment with status ${status}.`,
    );
  }
}

function isExclusionConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('excl_appointment_services_employee_time')
  );
}
