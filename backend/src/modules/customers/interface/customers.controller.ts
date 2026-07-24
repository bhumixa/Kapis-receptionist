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
import {
  buildCursorPage,
  decodeCursor,
} from '../../../common/utils/cursor-pagination.util';
import { CustomerService } from '../application/customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import {
  ListCustomersQueryDto,
  parseSort,
} from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { toCustomerResponseDto } from './mappers/customer-response.mapper';

/** `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id` (API_SPECIFICATION.md Section 9). */
@ApiTags('Customers')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class CustomersController {
  constructor(
    private readonly customers: CustomerService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list(@Query() query: ListCustomersQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { sortField, sortDirection } = parseSort(query.sort);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.customers.listCustomers(tenantId, {
      marketingOptIn: query.marketingOptIn,
      q: query.q,
      sortField,
      sortDirection,
      cursor,
      limit: query.limit,
    });

    const page = buildCursorPage(rows, query.limit, sortField);

    return paginated(page.items.map(toCustomerResponseDto), {
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
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = await this.tenantContext.requireTenantId();
    const customer = await this.customers.getCustomer(tenantId, id);
    return toCustomerResponseDto(customer);
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.STAFF)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const customer = await this.customers.createCustomer(tenantId, actor, dto);
    return toCustomerResponseDto(customer);
  }

  @Patch(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.STAFF)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const customer = await this.customers.updateCustomer(
      tenantId,
      id,
      actor,
      dto,
    );
    return toCustomerResponseDto(customer);
  }

  @Delete(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('customers:manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.customers.deleteCustomer(tenantId, id, actor);
    return { message: 'Customer removed.' };
  }
}
