import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { RequirePermission } from '../../../core/decorators/require-permission.decorator';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantActiveGuard } from '../../../core/guards/tenant-active.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { WhatsAppAccountService } from '../application/whatsapp-account.service';
import { ConnectWhatsAppAccountDto } from './dto/connect-whatsapp-account.dto';
import { toWhatsAppAccountResponseDto } from './mappers/whatsapp-response.mapper';

/**
 * `GET/POST/DELETE /whatsapp/account` (API_SPECIFICATION.md Section 11) —
 * `whatsapp:manage` gates connect/disconnect (OWNER/MANAGER only, matching
 * the sensitivity of connecting an external messaging credential, not
 * every tenant-scoped write); read is STAFF-broad so any front-desk user
 * can see connection status.
 */
@ApiTags('WhatsApp Account')
@Controller('whatsapp/account')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class WhatsAppAccountController {
  constructor(
    private readonly whatsappAccountService: WhatsAppAccountService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async getStatus() {
    const tenantId = await this.tenantContext.requireTenantId();
    const account = await this.whatsappAccountService.getAccount(tenantId);
    return account ? toWhatsAppAccountResponseDto(account) : null;
  }

  @Post()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('whatsapp:manage')
  async connect(
    @Body() dto: ConnectWhatsAppAccountDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const account = await this.whatsappAccountService.connectAccount(
      tenantId,
      actor,
      dto,
    );
    return toWhatsAppAccountResponseDto(account);
  }

  @Delete()
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.MANAGER)
  @RequirePermission('whatsapp:manage')
  async disconnect(@CurrentUser() actor: AccessTokenPayload) {
    const tenantId = await this.tenantContext.requireTenantId();
    const account = await this.whatsappAccountService.disconnectAccount(
      tenantId,
      actor,
    );
    return toWhatsAppAccountResponseDto(account);
  }
}
