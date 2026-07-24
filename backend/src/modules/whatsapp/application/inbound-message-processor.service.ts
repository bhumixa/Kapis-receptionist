import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  MessageDeliveryStatus,
  MessageType,
  WebhookProcessingStatus,
} from '@prisma/client';
import { RedisService } from '../../../database/redis.service';
import { CustomerService } from '../../customers/application/customer.service';
import { ConversationsService } from './conversations.service';
import {
  MESSAGE_REPOSITORY,
  type MessageRepositoryPort,
} from '../domain/ports/message-repository.port';
import {
  WEBHOOK_EVENT_REPOSITORY,
  type WebhookEventRepositoryPort,
} from '../domain/ports/webhook-event-repository.port';
import {
  WHATSAPP_ACCOUNT_REPOSITORY,
  type WhatsAppAccountRepositoryPort,
} from '../domain/ports/whatsapp-account-repository.port';

/** Redis dedup TTL (docs/DATABASE_DESIGN.md Section 10.7) — the DB partial-unique index on `whatsappMessageId` remains authoritative after this expires. */
const DEDUP_TTL_SECONDS = 60 * 60 * 48;

interface RawWhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: RawMedia & { caption?: string };
  video?: RawMedia & { caption?: string };
  audio?: RawMedia;
  document?: RawMedia & { caption?: string; filename?: string };
  sticker?: RawMedia;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  interactive?: unknown;
}

interface RawMedia {
  id: string;
  mime_type: string;
  sha256: string;
}

interface RawStatus {
  id: string;
  status: string;
}

interface RawContact {
  wa_id: string;
  profile?: { name?: string };
}

interface WebhookValue {
  metadata?: { phone_number_id?: string };
  contacts?: RawContact[];
  messages?: RawWhatsAppMessage[];
  statuses?: RawStatus[];
}

interface WhatsAppWebhookPayload {
  entry?: Array<{ changes?: Array<{ value?: WebhookValue }> }>;
}

const STATUS_MAP: Record<string, MessageDeliveryStatus> = {
  sent: MessageDeliveryStatus.SENT,
  delivered: MessageDeliveryStatus.DELIVERED,
  read: MessageDeliveryStatus.READ,
  failed: MessageDeliveryStatus.FAILED,
};

function mapMessageContent(message: RawWhatsAppMessage): {
  messageType: MessageType;
  content: string | null;
  mediaWhatsappId: string | null;
  mediaMimeType: string | null;
  mediaSha256: string | null;
  mediaFilename: string | null;
} {
  switch (message.type) {
    case 'text':
      return {
        messageType: MessageType.TEXT,
        content: message.text?.body ?? null,
        mediaWhatsappId: null,
        mediaMimeType: null,
        mediaSha256: null,
        mediaFilename: null,
      };
    case 'image':
      return {
        messageType: MessageType.IMAGE,
        content: message.image?.caption ?? null,
        mediaWhatsappId: message.image?.id ?? null,
        mediaMimeType: message.image?.mime_type ?? null,
        mediaSha256: message.image?.sha256 ?? null,
        mediaFilename: null,
      };
    case 'video':
      return {
        messageType: MessageType.VIDEO,
        content: message.video?.caption ?? null,
        mediaWhatsappId: message.video?.id ?? null,
        mediaMimeType: message.video?.mime_type ?? null,
        mediaSha256: message.video?.sha256 ?? null,
        mediaFilename: null,
      };
    case 'audio':
      return {
        messageType: MessageType.AUDIO,
        content: null,
        mediaWhatsappId: message.audio?.id ?? null,
        mediaMimeType: message.audio?.mime_type ?? null,
        mediaSha256: message.audio?.sha256 ?? null,
        mediaFilename: null,
      };
    case 'document':
      return {
        messageType: MessageType.DOCUMENT,
        content: message.document?.caption ?? null,
        mediaWhatsappId: message.document?.id ?? null,
        mediaMimeType: message.document?.mime_type ?? null,
        mediaSha256: message.document?.sha256 ?? null,
        mediaFilename: message.document?.filename ?? null,
      };
    case 'sticker':
      return {
        messageType: MessageType.STICKER,
        content: null,
        mediaWhatsappId: message.sticker?.id ?? null,
        mediaMimeType: message.sticker?.mime_type ?? null,
        mediaSha256: message.sticker?.sha256 ?? null,
        mediaFilename: null,
      };
    case 'location':
      return {
        messageType: MessageType.LOCATION,
        content: message.location ? JSON.stringify(message.location) : null,
        mediaWhatsappId: null,
        mediaMimeType: null,
        mediaSha256: null,
        mediaFilename: null,
      };
    case 'interactive':
      return {
        messageType: MessageType.INTERACTIVE,
        content: message.interactive
          ? JSON.stringify(message.interactive)
          : null,
        mediaWhatsappId: null,
        mediaMimeType: null,
        mediaSha256: null,
        mediaFilename: null,
      };
    default:
      return {
        messageType: MessageType.UNSUPPORTED,
        content: null,
        mediaWhatsappId: null,
        mediaMimeType: null,
        mediaSha256: null,
        mediaFilename: null,
      };
  }
}

/**
 * The business logic behind `whatsapp-inbound` BullMQ jobs
 * (`queues/whatsapp-inbound.processor.ts` is the thin BullMQ adapter that
 * calls this). Resolves tenant from `metadata.phone_number_id` — the
 * webhook-specific tenant-resolution path documented in docs/adr/
 * ADR-010-whatsapp-platform.md as a deliberate exception to
 * `TenantContextService` being the sole resolver everywhere else, since a
 * WhatsApp webhook carries no JWT at all.
 *
 * Idempotency is two-layered (mirroring ADR-009's booking-conflict
 * precedent): a fast Redis `SET NX` dedup check first, then the database's
 * own partial-unique index on `whatsappMessageId` as the backstop a
 * cold/evicted Redis key would otherwise miss.
 */
@Injectable()
export class InboundMessageProcessorService {
  private readonly logger = new Logger(InboundMessageProcessorService.name);

  constructor(
    @Inject(WEBHOOK_EVENT_REPOSITORY)
    private readonly webhookEvents: WebhookEventRepositoryPort,
    @Inject(WHATSAPP_ACCOUNT_REPOSITORY)
    private readonly whatsappAccounts: WhatsAppAccountRepositoryPort,
    @Inject(MESSAGE_REPOSITORY)
    private readonly messages: MessageRepositoryPort,
    private readonly conversationsService: ConversationsService,
    private readonly customerService: CustomerService,
    private readonly redis: RedisService,
  ) {}

  async process(webhookEventId: string): Promise<void> {
    const webhookEvent = await this.webhookEvents.findById(webhookEventId);
    if (!webhookEvent) {
      this.logger.warn(`WebhookEvent ${webhookEventId} not found — skipping`);
      return;
    }

    try {
      const payload = webhookEvent.payload as WhatsAppWebhookPayload;
      let resolvedTenantId: string | null = null;

      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (!value?.metadata?.phone_number_id) {
            continue;
          }

          const account = await this.whatsappAccounts.findByPhoneNumberId(
            value.metadata.phone_number_id,
          );
          if (!account) {
            this.logger.warn(
              `No WhatsAppAccount for phone_number_id ${value.metadata.phone_number_id} — dropping change`,
            );
            continue;
          }
          resolvedTenantId = account.tenantId;

          for (const message of value.messages ?? []) {
            await this.processInboundMessage(
              account.tenantId,
              account.id,
              value,
              message,
              webhookEvent.id,
            );
          }

          for (const status of value.statuses ?? []) {
            await this.processStatusUpdate(status);
          }
        }
      }

      await this.webhookEvents.updateStatus(
        webhookEventId,
        WebhookProcessingStatus.PROCESSED,
        resolvedTenantId ? { tenantId: resolvedTenantId } : undefined,
      );
    } catch (error) {
      await this.webhookEvents.updateStatus(
        webhookEventId,
        WebhookProcessingStatus.FAILED,
        { errorMessage: (error as Error).message },
      );
      throw error;
    }
  }

  private async processInboundMessage(
    tenantId: string,
    whatsappAccountId: string,
    value: WebhookValue,
    message: RawWhatsAppMessage,
    webhookEventId: string,
  ): Promise<void> {
    const dedupKey = `dedup:whatsapp:${message.id}`;
    const acquired = await this.redis.set(
      dedupKey,
      '1',
      'EX',
      DEDUP_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      this.logger.log(`Duplicate inbound message ${message.id} — skipped`);
      return;
    }

    const existing = await this.messages.findByWhatsappMessageId(message.id);
    if (existing) {
      this.logger.log(
        `Inbound message ${message.id} already persisted — skipped`,
      );
      return;
    }

    const profileName = value.contacts?.find(
      (contact) => contact.wa_id === message.from,
    )?.profile?.name;

    const customer = await this.customerService.findOrCreateByPhoneForTenant(
      tenantId,
      message.from,
      profileName,
    );

    const conversation =
      await this.conversationsService.findOrCreateOpenConversation(
        tenantId,
        customer.id,
        whatsappAccountId,
      );

    const mapped = mapMessageContent(message);
    const occurredAt = new Date(Number(message.timestamp) * 1000);

    try {
      await this.messages.create(tenantId, {
        conversationId: conversation.id,
        direction: 'INBOUND',
        senderType: ActorType.CUSTOMER,
        messageType: mapped.messageType,
        content: mapped.content,
        mediaWhatsappId: mapped.mediaWhatsappId,
        mediaMimeType: mapped.mediaMimeType,
        mediaSha256: mapped.mediaSha256,
        mediaFilename: mapped.mediaFilename,
        whatsappMessageId: message.id,
        status: MessageDeliveryStatus.DELIVERED,
        sourceWebhookEventId: webhookEventId,
      });
    } catch (error) {
      // Database-level idempotency backstop (partial-unique index) — a
      // concurrent duplicate that slipped past the Redis check above.
      const existingAfterRace = await this.messages.findByWhatsappMessageId(
        message.id,
      );
      if (existingAfterRace) {
        return;
      }
      throw error;
    }

    await this.conversationsService.touchLastMessage(
      tenantId,
      conversation.id,
      occurredAt,
      true,
    );
  }

  private async processStatusUpdate(status: RawStatus): Promise<void> {
    const mappedStatus = STATUS_MAP[status.status];
    if (!mappedStatus) {
      return;
    }
    await this.messages.updateStatusByWhatsappMessageId(
      status.id,
      mappedStatus,
    );
  }
}
