import { ConversationStatus, WhatsAppConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../../src/database/prisma.service';

/**
 * Seeds a `WhatsAppAccount` directly via Prisma (same "bypass the HTTP
 * connect flow" precedent `seedOwner`/`seedBookableSetup` already set) —
 * these integration specs test webhook ingestion/conversation/message
 * behavior, not the connect flow's live Meta credential verification.
 * `accessTokenEncrypted` is a placeholder string, never decrypted by these
 * tests (inbound processing never touches it; outbound-send tests leave
 * `connectionStatus` at its default `PENDING` deliberately, so
 * `OutboundMessageService.getSendableAccount` fails fast with
 * `AccountNotConnectedException` instead of attempting a real network call
 * to Meta from the BullMQ worker running in-process).
 */
export async function seedWhatsAppAccount(
  prisma: PrismaService,
  tenantId: string,
  overrides: {
    whatsappPhoneNumberId?: string;
    connectionStatus?: WhatsAppConnectionStatus;
  } = {},
): Promise<{ id: string; whatsappPhoneNumberId: string }> {
  const whatsappPhoneNumberId =
    overrides.whatsappPhoneNumberId ??
    `phone-number-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId,
      phoneNumber: '+15550001111',
      whatsappPhoneNumberId,
      whatsappBusinessAccountId: 'business-account-test',
      accessTokenEncrypted: 'not-a-real-encrypted-token',
      connectionStatus:
        overrides.connectionStatus ?? WhatsAppConnectionStatus.PENDING,
      connectedAt:
        overrides.connectionStatus === WhatsAppConnectionStatus.CONNECTED
          ? new Date()
          : null,
    },
  });

  return {
    id: account.id,
    whatsappPhoneNumberId: account.whatsappPhoneNumberId,
  };
}

export async function seedConversation(
  prisma: PrismaService,
  tenantId: string,
  input: {
    customerId: string;
    whatsappAccountId: string;
    status?: ConversationStatus;
    lastInboundMessageAt?: Date | null;
  },
): Promise<{ id: string }> {
  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      customerId: input.customerId,
      whatsappAccountId: input.whatsappAccountId,
      status: input.status ?? ConversationStatus.OPEN,
      lastMessageAt: input.lastInboundMessageAt ?? null,
      lastInboundMessageAt:
        input.lastInboundMessageAt === undefined
          ? new Date()
          : input.lastInboundMessageAt,
    },
  });
  return { id: conversation.id };
}

export async function seedCustomer(
  prisma: PrismaService,
  tenantId: string,
  phoneNumber: string,
): Promise<{ id: string }> {
  const customer = await prisma.customer.create({
    data: { tenantId, phoneNumber },
  });
  return { id: customer.id };
}

/**
 * Polls `check` until it returns truthy or `timeoutMs` elapses — needed
 * because inbound webhook processing happens asynchronously on a real
 * BullMQ worker/Redis connection in these integration tests (the same Nest
 * app instance `createTestApp()` boots registers the actual
 * `WhatsAppInboundProcessor`), not synchronously within the HTTP request.
 */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  {
    timeoutMs = 5000,
    intervalMs = 100,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
