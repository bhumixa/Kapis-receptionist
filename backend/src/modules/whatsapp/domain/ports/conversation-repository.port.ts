import { ConversationStatus } from '@prisma/client';
import type { CursorPayload } from '../../../../common/utils/cursor-pagination.util';
import { ConversationEntity } from '../entities/conversation.entity';

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');

export interface CreateConversationInput {
  customerId: string;
  whatsappAccountId: string;
}

export interface ConversationListFilter {
  statusIn?: ConversationStatus[];
  sortDirection: 'asc' | 'desc';
  cursor: CursorPayload | null;
  limit: number;
}

export interface ConversationRepositoryPort {
  findList(
    tenantId: string,
    filter: ConversationListFilter,
  ): Promise<ConversationEntity[]>;
  findByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<ConversationEntity | null>;
  /** The "current open thread" query (DATABASE_DESIGN.md) — most recent OPEN conversation for a customer, not a DB constraint. */
  findMostRecentOpenByCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<ConversationEntity | null>;
  create(
    tenantId: string,
    input: CreateConversationInput,
  ): Promise<ConversationEntity>;
  updateStatus(
    tenantId: string,
    id: string,
    status: ConversationStatus,
  ): Promise<ConversationEntity>;
  assignUser(
    tenantId: string,
    id: string,
    userId: string | null,
  ): Promise<ConversationEntity>;
  /** Bumps `lastMessageAt` always; also bumps `lastInboundMessageAt` when `isInbound`. */
  touchLastMessage(
    tenantId: string,
    id: string,
    occurredAt: Date,
    isInbound: boolean,
  ): Promise<void>;
}
