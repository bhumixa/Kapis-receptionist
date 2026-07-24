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
import { RoleName } from '@prisma/client';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantActiveGuard } from '../../../core/guards/tenant-active.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { paginated } from '../../../common/utils/paginated-response.util';
import {
  buildCursorPage,
  decodeCursor,
} from '../../../common/utils/cursor-pagination.util';
import { ConversationsService } from '../application/conversations.service';
import {
  ListConversationsQueryDto,
  parseConversationSort,
} from './dto/list-conversations-query.dto';
import { UpdateConversationStatusDto } from './dto/update-conversation-status.dto';
import { toConversationResponseDto } from './mappers/whatsapp-response.mapper';

/**
 * `GET/PATCH /conversations[/:id]` (API_SPECIFICATION.md Section 11) — open
 * to STAFF, matching the existing `appointments`/`customers` read pattern:
 * viewing and triaging conversations is normal front-desk work.
 */
@ApiTags('Conversations')
@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list(@Query() query: ListConversationsQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const sortDirection = parseConversationSort(query.sort);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.conversations.listConversations(tenantId, {
      statusIn: query.status,
      sortDirection,
      cursor,
      limit: query.limit,
    });

    const page = buildCursorPage(rows, query.limit, 'lastMessageAt');

    return paginated(page.items.map(toConversationResponseDto), {
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
    const conversation = await this.conversations.getConversation(tenantId, id);
    return toConversationResponseDto(conversation);
  }

  @Patch(':id')
  @UseGuards(TenantActiveGuard)
  @Roles(RoleName.STAFF)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationStatusDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const conversation = await this.conversations.updateStatus(
      tenantId,
      id,
      actor,
      dto.status,
    );
    return toConversationResponseDto(conversation);
  }
}
