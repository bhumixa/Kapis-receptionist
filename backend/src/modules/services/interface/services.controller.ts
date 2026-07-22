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
import { ServiceService } from '../application/service.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto, parseSort } from './dto/list-services-query.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { toServiceResponseDto } from './mappers/service-response.mapper';

/** `GET/POST /services`, `GET/PATCH/DELETE /services/:id` (docs/SERVICE_ARCHITECTURE.md, API_SPECIFICATION.md Section 8). */
@ApiTags('Services')
@Controller('services')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class ServicesController {
  constructor(
    private readonly services: ServiceService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list(@Query() query: ListServicesQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { sortField, sortDirection } = parseSort(query.sort);
    const { services, total } = await this.services.listServices(tenantId, {
      isActive: query.isActive,
      categoryId: query.categoryId,
      q: query.q,
      sortField,
      sortDirection,
      page: query.page,
      limit: query.limit,
    });

    return paginated(services.map(toServiceResponseDto), {
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
    const service = await this.services.getService(tenantId, id);
    return toServiceResponseDto(service);
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('services:manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateServiceDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const service = await this.services.createService(tenantId, actor, dto);
    return toServiceResponseDto(service);
  }

  @Patch(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('services:manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const service = await this.services.updateService(tenantId, id, actor, dto);
    return toServiceResponseDto(service);
  }

  @Delete(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('services:manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.services.deleteService(tenantId, id, actor);
    return { message: 'Service removed.' };
  }
}
