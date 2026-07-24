import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import { AiContextService } from '../application/ai-context.service';
import { PromptVersionService } from '../application/prompt-version.service';

/**
 * STAFF-readable AI dashboard endpoints — `GET /ai/context/:conversationId`
 * backs the frontend's dev-only AI reasoning/debug panel
 * (FRONTEND_ARCHITECTURE.md Section 6.6), `GET /ai/prompt-versions` backs
 * the Prompt Management UI. Both open to STAFF, matching the existing
 * `conversations`/`appointments` read pattern — viewing AI state is normal
 * front-desk trust-building, not an owner/manager-only action.
 */
@ApiTags('AI')
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class AiDashboardController {
  constructor(
    private readonly aiContext: AiContextService,
    private readonly promptVersions: PromptVersionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('context/:conversationId')
  @Roles(RoleName.STAFF)
  async getContext(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const context = await this.aiContext.getContext(tenantId, conversationId);
    return {
      conversationId: context.conversationId,
      currentIntent: context.currentIntent,
      state: context.state,
      lastToolCall: context.lastToolCall,
      updatedAt: context.updatedAt,
    };
  }

  @Get('prompt-versions')
  @Roles(RoleName.STAFF)
  async listPromptVersions() {
    return this.promptVersions.listVersions();
  }
}
