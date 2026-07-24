import { Inject, Injectable } from '@nestjs/common';
import { MessagesService } from '../../whatsapp/application/messages.service';
import { ConversationSummaryEntity } from '../domain/entities/conversation-summary.entity';
import {
  CONVERSATION_SUMMARY_REPOSITORY,
  type ConversationSummaryRepositoryPort,
} from '../domain/ports/conversation-summary-repository.port';

const HISTORY_LIMIT = 200;
const SUMMARY_MAX_CHARS = 2000;

/**
 * Denormalized rollup generation (SYSTEM_ARCHITECTURE.md 5.7) — a
 * deterministic digest of the message history, not an LLM call: cheap
 * enough to regenerate at natural conversation checkpoints (escalation,
 * resolution) without adding a second per-checkpoint OpenAI round-trip on
 * top of the conversational turns themselves. Explicitly a derived/cache
 * record (the entity's own doc comment) — always regeneratable from
 * `Message` history, never treated as authoritative.
 */
@Injectable()
export class ConversationSummaryService {
  constructor(
    @Inject(CONVERSATION_SUMMARY_REPOSITORY)
    private readonly repository: ConversationSummaryRepositoryPort,
    private readonly messages: MessagesService,
  ) {}

  getSummary(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationSummaryEntity | null> {
    return this.repository.findByConversationId(tenantId, conversationId);
  }

  async regenerate(
    tenantId: string,
    conversationId: string,
    lastCustomerIntent: string | null,
    aiPromptVersion: string | null,
  ): Promise<ConversationSummaryEntity> {
    const history = await this.messages.listMessages(tenantId, conversationId, {
      sortDirection: 'asc',
      cursor: null,
      limit: HISTORY_LIMIT,
    });

    const digest = history
      .filter((message) => message.content)
      .map(
        (message) => `${speakerLabel(message.senderType)}: ${message.content}`,
      )
      .join('\n');

    return this.repository.upsert(tenantId, conversationId, {
      summaryText: digest.slice(-SUMMARY_MAX_CHARS),
      messageCount: history.length,
      lastCustomerIntent,
      aiPromptVersion,
    });
  }
}

function speakerLabel(senderType: string): string {
  switch (senderType) {
    case 'CUSTOMER':
      return 'Customer';
    case 'AI':
      return 'AI';
    case 'USER':
      return 'Staff';
    default:
      return 'System';
  }
}
