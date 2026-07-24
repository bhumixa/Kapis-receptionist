import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../../core/idempotency/idempotency.module';
import { CustomersModule } from '../customers/customers.module';
import { WhatsAppQueueModule } from './queues/whatsapp-queue.module';
import { WhatsAppInboundProcessor } from './queues/whatsapp-inbound.processor';
import { WhatsAppOutboundProcessor } from './queues/whatsapp-outbound.processor';
import { CONVERSATION_REPOSITORY } from './domain/ports/conversation-repository.port';
import { MESSAGE_REPOSITORY } from './domain/ports/message-repository.port';
import { WEBHOOK_EVENT_REPOSITORY } from './domain/ports/webhook-event-repository.port';
import { WHATSAPP_ACCOUNT_REPOSITORY } from './domain/ports/whatsapp-account-repository.port';
import { PrismaConversationRepository } from './infrastructure/prisma-conversation.repository';
import { PrismaMessageRepository } from './infrastructure/prisma-message.repository';
import { PrismaWebhookEventRepository } from './infrastructure/prisma-webhook-event.repository';
import { PrismaWhatsAppAccountRepository } from './infrastructure/prisma-whatsapp-account.repository';
import { WhatsAppCloudApiClient } from './infrastructure/whatsapp-cloud-api.client';
import { ConversationsService } from './application/conversations.service';
import { MessagesService } from './application/messages.service';
import { WhatsAppAccountService } from './application/whatsapp-account.service';
import { WebhookIngestionService } from './application/webhook-ingestion.service';
import { InboundMessageProcessorService } from './application/inbound-message-processor.service';
import { OutboundMessageService } from './application/outbound-message.service';
import { ConversationsController } from './interface/conversations.controller';
import { MessagesController } from './interface/messages.controller';
import { WhatsAppAccountController } from './interface/whatsapp-account.controller';
import { WebhooksController } from './interface/webhooks.controller';

/**
 * Milestone 7's WhatsApp Cloud Platform integration (docs/WHATSAPP_
 * ARCHITECTURE.md, docs/MESSAGING_ARCHITECTURE.md, docs/adr/
 * ADR-010-whatsapp-platform.md). Deliberately a single module housing
 * `WhatsAppAccount`, `Conversation`, `Message`, and `WebhookEvent` — not
 * three separate modules as SYSTEM_ARCHITECTURE.md originally sketched
 * (Conversations/Messages/WhatsApp) — internally layered per aggregate.
 * `WhatsAppInboundProcessor`/`WhatsAppOutboundProcessor` (BullMQ workers)
 * are providers here, not in `WhatsAppQueueModule`, since they depend on
 * this module's own application-layer services.
 */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    IdempotencyModule,
    CustomersModule,
    WhatsAppQueueModule,
  ],
  controllers: [
    WebhooksController,
    WhatsAppAccountController,
    ConversationsController,
    MessagesController,
  ],
  providers: [
    {
      provide: CONVERSATION_REPOSITORY,
      useClass: PrismaConversationRepository,
    },
    { provide: MESSAGE_REPOSITORY, useClass: PrismaMessageRepository },
    {
      provide: WEBHOOK_EVENT_REPOSITORY,
      useClass: PrismaWebhookEventRepository,
    },
    {
      provide: WHATSAPP_ACCOUNT_REPOSITORY,
      useClass: PrismaWhatsAppAccountRepository,
    },
    WhatsAppCloudApiClient,
    ConversationsService,
    MessagesService,
    WhatsAppAccountService,
    WebhookIngestionService,
    InboundMessageProcessorService,
    OutboundMessageService,
    WhatsAppInboundProcessor,
    WhatsAppOutboundProcessor,
  ],
  exports: [ConversationsService, MessagesService],
})
export class WhatsAppModule {}
