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
  Put,
  Query,
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
import { paginated } from '../../../common/utils/paginated-response.util';
import { EmployeeAssignmentService } from '../application/employee-assignment.service';
import { EmployeeService } from '../application/employee.service';
import { AssignServicesDto } from './dto/assign-services.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  ListEmployeesQueryDto,
  parseEmployeeSort,
} from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { toEmployeeResponseDto } from './mappers/employee-response.mapper';

/**
 * `GET/POST /employees`, `GET/PATCH/DELETE /employees/:id`, `PUT
 * /employees/:id/services` (docs/WORKFORCE_ARCHITECTURE.md, API_
 * SPECIFICATION.md Section 7). `PUT .../services` lives here (not a
 * separate controller) since assignment is always mutated from the
 * employee side (docs/adr/ADR-008 decision #3).
 */
@ApiTags('Employees')
@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class EmployeesController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly assignments: EmployeeAssignmentService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list(@Query() query: ListEmployeesQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { sortField, sortDirection } = parseEmployeeSort(query.sort);

    const employeeIdsIn = query.serviceId
      ? await this.assignments.getEmployeeIdsForService(
          tenantId,
          query.serviceId,
        )
      : undefined;

    const { employees, total } = await this.employees.listEmployees(tenantId, {
      status: query.status,
      employeeIdsIn,
      q: query.q,
      sortField,
      sortDirection,
      page: query.page,
      limit: query.limit,
    });

    const dtos = await Promise.all(
      employees.map(async (employee) =>
        toEmployeeResponseDto(
          employee,
          await this.assignments.getServiceIdsForEmployee(
            tenantId,
            employee.id,
          ),
        ),
      ),
    );

    return paginated(dtos, {
      pagination: {
        strategy: 'offset',
        page: query.page,
        limit: query.limit,
        totalItems: total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }

  @Get(':id')
  @Roles(RoleName.STAFF)
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = await this.tenantContext.requireTenantId();
    const employee = await this.employees.getEmployee(tenantId, id);
    const serviceIds = await this.assignments.getServiceIdsForEmployee(
      tenantId,
      id,
    );
    return toEmployeeResponseDto(employee, serviceIds);
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('employees:manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const employee = await this.employees.createEmployee(tenantId, actor, dto);
    const serviceIds = await this.assignments.getServiceIdsForEmployee(
      tenantId,
      employee.id,
    );
    return toEmployeeResponseDto(employee, serviceIds);
  }

  @Patch(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('employees:manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const employee = await this.employees.updateEmployee(
      tenantId,
      id,
      actor,
      dto,
    );
    const serviceIds = await this.assignments.getServiceIdsForEmployee(
      tenantId,
      id,
    );
    return toEmployeeResponseDto(employee, serviceIds);
  }

  @Delete(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('employees:manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.employees.deleteEmployee(tenantId, id, actor);
    return { message: 'Employee removed.' };
  }

  @Put(':id/services')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('employees:manage')
  async assignServices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignServicesDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.employees.getEmployee(tenantId, id);
    const serviceIds = await this.assignments.assignServices(
      tenantId,
      id,
      dto.serviceIds,
      actor,
    );
    return { serviceIds };
  }
}
