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
import { ServiceCategoryService } from '../application/service-category.service';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { toServiceCategoryResponseDto } from './mappers/service-response.mapper';

/** `GET/POST/PATCH/DELETE /service-categories[/:id]` (docs/SERVICE_ARCHITECTURE.md). */
@ApiTags('Services')
@Controller('service-categories')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class ServiceCategoriesController {
  constructor(
    private readonly categories: ServiceCategoryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list() {
    const tenantId = await this.tenantContext.requireTenantId();
    const categories = await this.categories.listCategories(tenantId);
    return categories.map(toServiceCategoryResponseDto);
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('services:manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateServiceCategoryDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const category = await this.categories.createCategory(tenantId, actor, dto);
    return toServiceCategoryResponseDto(category);
  }

  @Patch(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('services:manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCategoryDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const category = await this.categories.updateCategory(
      tenantId,
      id,
      actor,
      dto,
    );
    return toServiceCategoryResponseDto(category);
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
    await this.categories.deleteCategory(tenantId, id, actor);
    return { message: 'Service category deleted.' };
  }
}
