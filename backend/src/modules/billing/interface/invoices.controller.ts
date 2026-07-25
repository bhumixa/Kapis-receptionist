import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import { paginated } from '../../../common/utils/paginated-response.util';
import { InvoicesService } from '../application/invoices.service';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import {
  toInvoiceResponseDto,
  toPaymentResponseDto,
} from './mappers/billing-response.mapper';

/** `GET /invoices`, `GET /payments` (API_SPECIFICATION.md Section 13) — read-only, Owner/Manager. */
@ApiTags('Billing')
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.MANAGER)
  async list(@Query() query: ListInvoicesQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { items, total } = await this.invoicesService.listForTenant(
      tenantId,
      query.page,
      query.pageSize,
    );
    return paginated(items.map(toInvoiceResponseDto), {
      pagination: { page: query.page, pageSize: query.pageSize, total },
    });
  }
}

@ApiTags('Billing')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class PaymentsController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.MANAGER)
  async list(@Query() query: ListInvoicesQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { items, total } = await this.invoicesService.listPaymentsForTenant(
      tenantId,
      query.page,
      query.pageSize,
    );
    return paginated(items.map(toPaymentResponseDto), {
      pagination: { page: query.page, pageSize: query.pageSize, total },
    });
  }
}
