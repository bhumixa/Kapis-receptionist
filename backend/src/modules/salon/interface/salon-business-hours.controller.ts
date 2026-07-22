import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantActiveGuard } from '../../../core/guards/tenant-active.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { RequirePermission } from '../../../core/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { BusinessHoursService } from '../application/business-hours.service';
import type { BusinessHoursDayInput } from '../domain/ports/business-hours-repository.port';
import { UpdateBusinessHoursDto } from './dto/update-business-hours.dto';
import { toBusinessHoursResponseDto } from './mappers/salon-response.mapper';

/** `GET/PUT /salon/business-hours` (docs/SALON_ARCHITECTURE.md) — always the full 7-day week. */
@ApiTags('Salon')
@Controller('salon/business-hours')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class SalonBusinessHoursController {
  constructor(
    private readonly businessHours: BusinessHoursService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async getBusinessHours() {
    const tenantId = await this.tenantContext.requireTenantId();
    const days = await this.businessHours.getBusinessHours(tenantId);
    return days.map(toBusinessHoursResponseDto);
  }

  @Put()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('salon:manage')
  async replaceBusinessHours(
    @Body() dto: UpdateBusinessHoursDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const days: BusinessHoursDayInput[] = dto.days.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      // A closed day's times are irrelevant business-wise but the column
      // is NOT NULL — normalize to a placeholder regardless of what (if
      // anything) the client sent for a closed day.
      startTime: day.isClosed ? '00:00' : day.startTime,
      endTime: day.isClosed ? '00:00' : day.endTime,
      isClosed: day.isClosed,
    }));
    const updated = await this.businessHours.replaceBusinessHours(
      tenantId,
      actor,
      days,
    );
    return updated.map(toBusinessHoursResponseDto);
  }
}
