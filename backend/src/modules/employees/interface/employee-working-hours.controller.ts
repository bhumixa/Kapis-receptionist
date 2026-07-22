import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
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
import { EmployeeService } from '../application/employee.service';
import { WorkingHoursService } from '../application/working-hours.service';
import { UpdateWorkingHoursDto } from './dto/update-working-hours.dto';
import { toWorkingHoursResponseDto } from './mappers/employee-response.mapper';

/** `GET/PUT /employees/:id/working-hours` (docs/WORKFORCE_ARCHITECTURE.md). */
@ApiTags('Employees')
@Controller('employees/:employeeId/working-hours')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class EmployeeWorkingHoursController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly workingHours: WorkingHoursService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.employees.getEmployee(tenantId, employeeId);
    const entries = await this.workingHours.getWorkingHours(
      tenantId,
      employeeId,
    );
    return entries.map(toWorkingHoursResponseDto);
  }

  @Put()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('employees:manage')
  async replace(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpdateWorkingHoursDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.employees.getEmployee(tenantId, employeeId);
    const entries = await this.workingHours.replaceWorkingHours(
      tenantId,
      employeeId,
      actor,
      dto.entries,
    );
    return entries.map(toWorkingHoursResponseDto);
  }
}
