import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../../../core/guards/super-admin.guard';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { InvoicesService } from '../../billing/application/invoices.service';
import { PlansService } from '../../billing/application/plans.service';
import { SubscriptionsService } from '../../billing/application/subscriptions.service';
import { UpdatePlanDto } from '../../billing/interface/dto/update-plan.dto';
import {
  toInvoiceResponseDto,
  toPlanResponseDto,
  toSubscriptionResponseDto,
} from '../../billing/interface/mappers/billing-response.mapper';
import { ListInvoicesQueryDto } from '../../billing/interface/dto/list-invoices-query.dto';
import { TenantService } from '../../tenants/application/tenant.service';

/**
 * `GET/PATCH /admin/plans[/:id]`, `GET /admin/tenants/:id/billing`
 * (Platform Admin — "Plans", "Subscription lookup", "Tenant billing status"
 * from the milestone brief). `SUPER_ADMIN` only, on every endpoint, same
 * convention as `AdminTenantsController`. Deliberately lives in
 * `modules/admin` (not `modules/billing`) — `modules/billing`'s own
 * controllers are tenant-scoped (`TenantScopedGuard` + `TenantContextService`
 * resolving the *caller's own* tenant); Platform Admin needs to look up an
 * *arbitrary* tenant by id, a fundamentally different access pattern that
 * belongs alongside `AdminTenantsController`, mirroring
 * `SYSTEM_ARCHITECTURE.md` Section 3.2's `Admin` module boundary ("isolated
 * from tenant-scoped modules to avoid accidental cross-tenant exposure").
 */
@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminBillingController {
  constructor(
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly invoicesService: InvoicesService,
    private readonly tenantService: TenantService,
  ) {}

  @Get('plans')
  async listPlans() {
    const plans = await this.plansService.listAllPlans();
    return plans.map(toPlanResponseDto);
  }

  @Patch('plans/:id')
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const plan = await this.plansService.updatePlan(id, dto, actor);
    return toPlanResponseDto(plan);
  }

  @Get('tenants/:id/billing')
  async getTenantBilling(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Query() query: ListInvoicesQueryDto,
  ) {
    // Throws `TenantResourceNotFoundException` (404) for an unknown id
    // before `EntitlementService`'s defensive backfill would otherwise
    // attempt (and fail) to create a `Subscription` row for a
    // non-existent `Tenant`.
    await this.tenantService.getProfileForAdmin(tenantId);

    const [{ subscription, plan }, invoices] = await Promise.all([
      this.subscriptionsService.getForTenant(tenantId),
      this.invoicesService.listForTenant(tenantId, query.page, query.pageSize),
    ]);

    return {
      subscription: toSubscriptionResponseDto(subscription, plan),
      invoices: {
        items: invoices.items.map(toInvoiceResponseDto),
        page: query.page,
        pageSize: query.pageSize,
        total: invoices.total,
      },
    };
  }
}
