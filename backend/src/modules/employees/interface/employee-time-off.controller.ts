import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { EmployeeService } from '../application/employee.service';
import { EmployeeTimeOffService } from '../application/employee-time-off.service';
import { CreateTimeOffDto } from './dto/create-time-off.dto';
import { toTimeOffResponseDto } from './mappers/employee-response.mapper';

/** `GET/POST/DELETE /employees/:id/time-off[/:id]` (docs/WORKFORCE_ARCHITECTURE.md). */
@ApiTags('Employees')
@Controller('employees/:employeeId/time-off')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class EmployeeTimeOffController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly timeOff: EmployeeTimeOffService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.employees.getEmployee(tenantId, employeeId);
    const entries = await this.timeOff.listTimeOff(tenantId, employeeId);
    return entries.map(toTimeOffResponseDto);
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('employees:manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateTimeOffDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.employees.getEmployee(tenantId, employeeId);
    const entry = await this.timeOff.createTimeOff(
      tenantId,
      employeeId,
      actor,
      dto,
    );
    return toTimeOffResponseDto(entry);
  }

  @Delete(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('employees:manage')
  async remove(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.employees.getEmployee(tenantId, employeeId);
    await this.timeOff.deleteTimeOff(tenantId, employeeId, id, actor);
    return { message: 'Time off deleted.' };
  }
}
