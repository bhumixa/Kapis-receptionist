import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  WHATSAPP_INBOUND_QUEUE,
  WHATSAPP_OUTBOUND_QUEUE,
} from './whatsapp-queue.constants';

/**
 * Registers the two named BullMQ queues against the shared root connection
 * (`queues/bullmq-root.module.ts`) and re-exports `BullModule` so
 * `@InjectQueue()` resolves wherever this module is imported.
 *
 * Deliberately does *not* also declare the processors
 * (`WhatsAppInboundProcessor`/`WhatsAppOutboundProcessor`) — they depend on
 * application-layer services (`InboundMessageProcessorService`,
 * `OutboundMessageService`) that live in `whatsapp.module.ts`, and
 * registering them here would create a circular module dependency. They're
 * providers of `WhatsAppModule` instead, which imports this module for the
 * queue tokens.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: WHATSAPP_INBOUND_QUEUE },
      { name: WHATSAPP_OUTBOUND_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class WhatsAppQueueModule {}
