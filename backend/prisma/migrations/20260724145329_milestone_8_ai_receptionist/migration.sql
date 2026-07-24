-- AlterEnum
ALTER TYPE "ConversationStatus" ADD VALUE 'ESCALATED';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationReason" VARCHAR(255);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "aiPromptVersion" VARCHAR(50);

-- CreateTable
CREATE TABLE "ai_contexts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "currentIntent" VARCHAR(50),
    "state" JSONB NOT NULL DEFAULT '{}',
    "lastToolCall" VARCHAR(50),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "summaryText" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "lastCustomerIntent" VARCHAR(100),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiPromptVersion" VARCHAR(50),

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(50) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "description" VARCHAR(255),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_contexts_conversationId_key" ON "ai_contexts"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_summaries_conversationId_key" ON "conversation_summaries"("conversationId");

-- CreateIndex
CREATE INDEX "idx_prompt_versions_key_active" ON "prompt_versions"("key", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_key_version_key" ON "prompt_versions"("key", "version");

-- AddForeignKey
ALTER TABLE "ai_contexts" ADD CONSTRAINT "ai_contexts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
