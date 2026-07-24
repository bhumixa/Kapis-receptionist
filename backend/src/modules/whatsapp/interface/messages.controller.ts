import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { Roles } from '../../../core/decorators/roles.decorator';
import { PermissionGuard } from '../../../core/guards/permission.guard';
import { RolesGuard } from '../../../core/guards/roles.guard';
import { TenantActiveGuard } from '../../../core/guards/tenant-active.guard';
import { TenantScopedGuard } from '../../../core/guards/tenant-scoped.guard';
import { IdempotencyInterceptor } from '../../../core/idempotency/idempotency.interceptor';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { paginated } from '../../../common/utils/paginated-response.util';
import {
  buildCursorPage,
  decodeCursor,
} from '../../../common/utils/cursor-pagination.util';
import { MessagesService } from '../application/messages.service';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { toMessageResponseDto } from './mappers/whatsapp-response.mapper';

/**
 * `GET /messages`, `POST /messages/send` (API_SPECIFICATION.md Section 11)
 * — `filter[conversationId]` (here: required `conversationId` query param)
 * is mandatory on the list endpoint, never a tenant-wide firehose. Open to
 * STAFF, matching the existing appointments/customers pattern.
 */
@ApiTags('Messages')
@Controller('messages')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard, TenantScopedGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(RoleName.STAFF)
  async list(@Query() query: ListMessagesQueryDto) {
    const tenantId = await this.tenantContext.requireTenantId();
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.messagesService.listMessages(
      tenantId,
      query.conversationId,
      { sortDirection: 'asc', cursor, limit: query.limit },
    );

    const page = buildCursorPage(rows, query.limit, 'createdAt');

    return paginated(page.items.map(toMessageResponseDto), {
      pagination: {
        strategy: 'cursor',
        limit: query.limit,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    });
  }

  @Post('send')
  @UseGuards(TenantActiveGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @Roles(RoleName.STAFF)
  @HttpCode(HttpStatus.ACCEPTED)
  async send(
    @Body() dto: SendMessageDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenantId = await this.tenantContext.requireTenantId();
    const message = await this.messagesService.sendMessage(tenantId, actor, {
      conversationId: dto.conversationId,
      body: dto.body,
    });
    return toMessageResponseDto(message);
  }
}
