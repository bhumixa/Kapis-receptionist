import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantActiveGuard } from '../../../core/guards/tenant-active.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { RequirePermission } from '../../../core/decorators/require-permission.decorator';
import { IdempotencyInterceptor } from '../../../core/idempotency/idempotency.interceptor';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { paginated } from '../../../common/utils/paginated-response.util';
import {
  buildCursorPage,
  decodeCursor,
} from '../../../common/utils/cursor-pagination.util';
import { AvailabilityService } from '../../availability/application/availability.service';
import { GetAvailabilityQueryDto } from '../../availability/interface/dto/get-availability-query.dto';
import { toAvailabilitySlotResponseDto } from '../../availability/interface/mappers/availability-response.mapper';
import { AppointmentsService } from '../application/appointments.service';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import {
  ListAppointmentsQueryDto,
  parseAppointmentSort,
} from './dto/list-appointments-query.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { toAppointmentResponseDto } from './mappers/appointment-response.mapper';

/**
 * `GET/POST/PATCH/DELETE /appointments[/:id]`, `.../cancel`, `.../
 * reschedule`, `GET /appointments/availability` (API_SPECIFICATION.md
 * Section 10). `GET .../availability` is declared before `GET /:id` so
 * Express's route-matching order doesn't treat `availability` as an `:id`.
 */
@ApiTags('Appointments')
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('availability')
  @Roles(RoleName.STAFF)
  async getAvailability(@Query() query: GetAvailabilityQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const slots = await this.availability.getAvailableSlots(tenantId, {
      serviceId: query.serviceId,
      employeeId: query.employeeId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
    return slots.map(toAvailabilitySlotResponseDto);
  }

  @Get()
  @Roles(RoleName.STAFF)
  async list(
    @Query() query: ListAppointmentsQueryDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const sortDirection = parseAppointmentSort(query.sort);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.appointments.listAppointments(tenantId, actor, {
      statusIn: query.status,
      employeeId: query.employeeId,
      customerId: query.customerId,
      startTimeGte: query.startTimeFrom
        ? new Date(query.startTimeFrom)
        : undefined,
      startTimeLte: query.startTimeTo ? new Date(query.startTimeTo) : undefined,
      sortDirection,
      cursor,
      limit: query.limit,
    });

    const page = buildCursorPage(rows, query.limit, 'startTime');

    return paginated(page.items.map(toAppointmentResponseDto), {
      pagination: {
        strategy: 'cursor',
        limit: query.limit,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    });
  }

  @Get(':id')
  @Roles(RoleName.STAFF)
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const appointment = await this.appointments.getAppointment(
      tenantId,
      id,
      actor,
    );
    return toAppointmentResponseDto(appointment);
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @Roles(RoleName.STAFF)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const appointment = await this.appointments.createAppointment(
      tenantId,
      actor,
      {
        customerId: dto.customerId,
        startTime: new Date(dto.startTime),
        services: dto.services,
        notes: dto.notes,
      },
    );
    return toAppointmentResponseDto(appointment);
  }

  @Patch(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.STAFF)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const appointment = await this.appointments.updateNotes(
      tenantId,
      id,
      actor,
      dto.notes,
    );
    return toAppointmentResponseDto(appointment);
  }

  @Delete(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.OWNER)
  @RequirePermission('appointments:manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.appointments.deleteAppointment(tenantId, id, actor);
    return { message: 'Appointment removed.' };
  }

  @Post(':id/cancel')
  @UseGuards(TenantActiveGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @Roles(RoleName.STAFF)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { appointment, warnings } = await this.appointments.cancelAppointment(
      tenantId,
      id,
      actor,
      dto.reason,
    );
    return {
      ...toAppointmentResponseDto(appointment),
      warnings,
      message: 'Appointment cancelled.',
    };
  }

  @Post(':id/reschedule')
  @UseGuards(TenantActiveGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @Roles(RoleName.STAFF)
  @HttpCode(HttpStatus.OK)
  async reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { originalAppointment, newAppointment, warnings } =
      await this.appointments.rescheduleAppointment(tenantId, id, actor, {
        newStartTime: new Date(dto.newStartTime),
        services: dto.services,
      });
    return {
      originalAppointment: toAppointmentResponseDto(originalAppointment),
      newAppointment: toAppointmentResponseDto(newAppointment),
      warnings,
      message: 'Appointment rescheduled.',
    };
  }
}
