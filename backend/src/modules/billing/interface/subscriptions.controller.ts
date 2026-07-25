import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { RequirePermission } from '../../../core/decorators/require-permission.decorator';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { IdempotencyInterceptor } from '../../../core/idempotency/idempotency.interceptor';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { CheckoutService } from '../application/checkout.service';
import { CustomerPortalService } from '../application/customer-portal.service';
import { SubscriptionsService } from '../application/subscriptions.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { toSubscriptionResponseDto } from './mappers/billing-response.mapper';

/**
 * `GET/POST /subscriptions`, `.../change-plan`, `.../cancel`, `.../reactivate`,
 * `.../portal-session` (API_SPECIFICATION.md Section 13). Deliberately never
 * gated by `TenantActiveGuard` on any route here — a `PAST_DUE`/`SUSPENDED`
 * tenant must still be able to reach every one of these to fix their
 * billing (mirrors `/app/billing`'s frontend routing exemption,
 * docs/FRONTEND_ARCHITECTURE.md Section 3.3). `billing:manage` is seeded
 * for `OWNER`/`SUPER_ADMIN` only, matching PROJECT_REQUIREMENTS.md Business
 * Rule 8 (only the Owner manages billing) — `MANAGER` gets read-only access.
 */
@ApiTags('Billing')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly checkoutService: CheckoutService,
    private readonly customerPortalService: CustomerPortalService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.MANAGER)
  async getCurrent() {
    const tenantId = await this.tenantContext.requireTenantId();
    const { subscription, plan } =
      await this.subscriptionsService.getForTenant(tenantId);
    return toSubscriptionResponseDto(subscription, plan);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @Roles(RoleName.OWNER)
  @RequirePermission('billing:manage')
  async createCheckoutSession(
    @Body() dto: CreateCheckoutSessionDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    return this.checkoutService.createCheckoutSession(
      tenantId,
      dto.planId,
      actor,
      dto.couponCode,
    );
  }

  @Post('change-plan')
  @Roles(RoleName.OWNER)
  @RequirePermission('billing:manage')
  async changePlan(
    @Body() dto: ChangePlanDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const { subscription, plan } = await this.subscriptionsService.changePlan(
      tenantId,
      dto.planId,
      actor,
    );
    return toSubscriptionResponseDto(subscription, plan);
  }

  @Post('cancel')
  @Roles(RoleName.OWNER)
  @RequirePermission('billing:manage')
  async cancel(@CurrentUser() actor: AccessTokenPayload) {
    const tenantId = await this.tenantContext.requireTenantId();
    const subscription = await this.subscriptionsService.cancel(
      tenantId,
      actor,
    );
    const { plan } = await this.subscriptionsService.getForTenant(tenantId);
    return toSubscriptionResponseDto(subscription, plan);
  }

  @Post('reactivate')
  @Roles(RoleName.OWNER)
  @RequirePermission('billing:manage')
  async reactivate(@CurrentUser() actor: AccessTokenPayload) {
    const tenantId = await this.tenantContext.requireTenantId();
    const subscription = await this.subscriptionsService.reactivate(
      tenantId,
      actor,
    );
    const { plan } = await this.subscriptionsService.getForTenant(tenantId);
    return toSubscriptionResponseDto(subscription, plan);
  }

  @Post('portal-session')
  @Roles(RoleName.OWNER)
  @RequirePermission('billing:manage')
  async createPortalSession() {
    const tenantId = await this.tenantContext.requireTenantId();
    return this.customerPortalService.createPortalSession(tenantId);
  }
}
