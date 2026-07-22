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
  UseGuards,
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
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { HolidayService } from '../application/holiday.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { toHolidayResponseDto } from './mappers/salon-response.mapper';

/**
 * `GET/POST/PATCH/DELETE /salon/holidays[/:id]` (docs/SALON_ARCHITECTURE.md)
 * — small per-tenant list (a handful per year), no pagination, matching
 * `GET /tenant/invitations`'s same precedent.
 */
@ApiTags('Salon')
@Controller('salon/holidays')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class SalonHolidaysController {
  constructor(
    private readonly holidays: HolidayService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list() {
    const tenantId = await this.tenantContext.requireTenantId();
    const holidays = await this.holidays.listHolidays(tenantId);
    return holidays.map(toHolidayResponseDto);
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('salon:manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateHolidayDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const holiday = await this.holidays.createHoliday(tenantId, actor, dto);
    return toHolidayResponseDto(holiday);
  }

  @Patch(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('salon:manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const holiday = await this.holidays.updateHoliday(tenantId, id, actor, dto);
    return toHolidayResponseDto(holiday);
  }

  @Delete(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('salon:manage')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.holidays.deleteHoliday(tenantId, id, actor);
    return { message: 'Holiday deleted.' };
  }
}
