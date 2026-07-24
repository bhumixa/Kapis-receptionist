-- CreateEnum
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'STICKER', 'LOCATION', 'INTERACTIVE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "phoneNumber" VARCHAR(20) NOT NULL,
    "whatsappPhoneNumberId" VARCHAR(100) NOT NULL,
    "whatsappBusinessAccountId" VARCHAR(100) NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "connectionStatus" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "whatsappAccountId" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignedUserId" UUID,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundMessageAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "senderType" "ActorType" NOT NULL,
    "senderId" UUID,
    "messageType" "MessageType" NOT NULL,
    "content" TEXT,
    "mediaWhatsappId" VARCHAR(255),
    "mediaMimeType" VARCHAR(100),
    "mediaSha256" VARCHAR(64),
    "mediaFilename" VARCHAR(255),
    "mediaSizeBytes" INTEGER,
    "whatsappMessageId" VARCHAR(100),
    "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "failureReason" VARCHAR(500),
    "sourceWebhookEventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID,
    "whatsappMessageId" VARCHAR(100),
    "eventType" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "errorMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_tenantId_key" ON "whatsapp_accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_whatsappPhoneNumberId_key" ON "whatsapp_accounts"("whatsappPhoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_tenantId_id_key" ON "whatsapp_accounts"("tenantId", "id");

-- CreateIndex
CREATE INDEX "idx_conversations_tenant_customer" ON "conversations"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "idx_conversations_tenant_status_last_message" ON "conversations"("tenantId", "status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenantId_id_key" ON "conversations"("tenantId", "id");

-- CreateIndex
CREATE INDEX "idx_messages_conversation_created" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_messages_tenant_created" ON "messages"("tenantId", "createdAt");

-- Manual edit (docs/PRISMA_SCHEMA.md Section 14.4's documented mechanism):
-- a partial unique index, not a plain one — most messages never touch
-- Meta at all conceptually (this column is only set once Meta assigns a
-- wamid), and Prisma has no declarative "unique when not null" syntax. This
-- is the idempotency guard against Meta's at-least-once webhook delivery,
-- paired with a fast Redis dedup check (`dedup:whatsapp:{whatsappMessageId}`)
-- as the first layer — mirroring the two-layer conflict-prevention
-- philosophy ADR-009 established for booking.
CREATE UNIQUE INDEX "uq_messages_whatsapp_message_id" ON "messages"("whatsappMessageId") WHERE "whatsappMessageId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "idx_webhook_events_processing_status" ON "whatsapp_webhook_events"("processingStatus");

-- CreateIndex
CREATE INDEX "idx_webhook_events_tenant_created" ON "whatsapp_webhook_events"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_whatsappAccountId_fkey" FOREIGN KEY ("tenantId", "whatsappAccountId") REFERENCES "whatsapp_accounts"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sourceWebhookEventId_fkey" FOREIGN KEY ("sourceWebhookEventId") REFERENCES "whatsapp_webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
