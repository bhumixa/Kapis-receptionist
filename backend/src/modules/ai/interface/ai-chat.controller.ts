import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantContextService } from '../../../core/context/tenant-context.service';
import { AiChatAuthGuard } from '../../../core/guards/ai-chat-auth.guard';
import { ConversationOrchestratorService } from '../application/conversation-orchestrator.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { AiRateLimitGuard } from './ai-rate-limit.guard';

/**
 * `POST /ai/chat` (API_SPECIFICATION.md Section 12) — **not part of the
 * frontend team's direct HTTP contract** in the way most controllers here
 * are: the dashboard "Test my AI" sandbox is the one legitimate Angular
 * caller (`channel: "dashboard_test"`); real WhatsApp-triggered turns run
 * in-process via `ConversationOrchestratorService` directly
 * (`InboundMessageProcessorService`, docs/adr/ADR-011-ai-receptionist.md)
 * and never hit this endpoint. It exists for that dashboard path plus the
 * QA/eval/future-extraction testability rationale Section 12's
 * architectural note describes.
 */
@ApiTags('AI')
@Controller('ai')
export class AiChatController {
  constructor(
    private readonly orchestrator: ConversationOrchestratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AiChatAuthGuard, AiRateLimitGuard)
  async chat(@Body() dto: ChatRequestDto) {
    const tenantId = await this.tenantContext.requireTenantId();

    const result = await this.orchestrator.runTurn({
      tenantId,
      conversationId: dto.conversationId ?? null,
      message: dto.message,
      persist: dto.channel === 'whatsapp',
    });

    return {
      conversationId: result.conversationId,
      messageId: result.messageId,
      replyText: result.replyText,
      toolCallsExecuted: result.toolCallsExecuted,
      promptVersion: result.promptVersion,
      meta: { degraded: result.degraded },
    };
  }
}
