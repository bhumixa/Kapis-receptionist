import { WhatsAppConnectionStatus } from '@prisma/client';
import { WhatsAppAccountEntity } from '../entities/whatsapp-account.entity';

export const WHATSAPP_ACCOUNT_REPOSITORY = Symbol(
  'WHATSAPP_ACCOUNT_REPOSITORY',
);

export interface ConnectWhatsAppAccountInput {
  phoneNumber: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  accessTokenEncrypted: string;
}

export interface WhatsAppAccountRepositoryPort {
  findByTenantId(tenantId: string): Promise<WhatsAppAccountEntity | null>;
  /**
   * Global lookup (no `tenantId` filter) — this is the tenant-resolution
   * mechanism for inbound webhooks, which carry no JWT/tenant context at
   * all (docs/adr/ADR-010-whatsapp-platform.md's documented exception to
   * `TenantContextService` being the sole resolver elsewhere in the app).
   */
  findByPhoneNumberId(
    whatsappPhoneNumberId: string,
  ): Promise<WhatsAppAccountEntity | null>;
  create(
    tenantId: string,
    input: ConnectWhatsAppAccountInput,
  ): Promise<WhatsAppAccountEntity>;
  updateConnectionStatus(
    tenantId: string,
    status: WhatsAppConnectionStatus,
    extra?: { connectedAt?: Date; disconnectedAt?: Date },
  ): Promise<WhatsAppAccountEntity>;
}
