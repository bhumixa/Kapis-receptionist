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
import { TenantInvitationService } from '../application/tenant-invitation.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { toInvitationResponseDto } from './mappers/tenant-response.mapper';

/**
 * `POST/GET /tenant/invitations`, `DELETE /tenant/invitations/:id` —
 * deliberately kept under `/tenant/invitations` rather than
 * API_SPECIFICATION.md's originally-implied `/users` path (docs/adr/ADR-006:
 * `TenantInvitation` is genuinely tenant-owned data; a full `Users`
 * staff-CRUD module is out of this milestone's scope).
 */
@ApiTags('Tenant')
@Controller('tenant/invitations')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
@Roles(RoleName.MANAGER)
@RequirePermission('staff:invite')
export class TenantInvitationsController {
  constructor(
    private readonly invitations: TenantInvitationService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @UseGuards(TenantActiveGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const invitation = await this.invitations.createInvitation(
      tenantId,
      actor,
      dto,
    );
    return {
      ...toInvitationResponseDto(invitation),
      message: 'Invitation sent.',
    };
  }

  @Get()
  async list() {
    const tenantId = await this.tenantContext.requireTenantId();
    const pending = await this.invitations.listPending(tenantId);
    return pending.map(toInvitationResponseDto);
  }

  @Delete(':id')
  @UseGuards(TenantActiveGuard)
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    await this.invitations.revoke(tenantId, id, actor);
    return { message: 'Invitation revoked.' };
  }
}
