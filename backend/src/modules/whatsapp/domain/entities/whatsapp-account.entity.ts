import { WhatsAppConnectionStatus } from '@prisma/client';

/**
 * A tenant's connected WhatsApp Business number (Milestone 7,
 * docs/WHATSAPP_ARCHITECTURE.md). 1:1 with `Tenant`. `accessTokenEncrypted`
 * is never exposed on this entity's consumers outside the application
 * layer that decrypts it immediately before a Cloud API call — response
 * DTOs never include it (see `interface/mappers`).
 */
export interface WhatsAppAccountEntity {
  id: string;
  tenantId: string;
  phoneNumber: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  accessTokenEncrypted: string;
  connectionStatus: WhatsAppConnectionStatus;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastHealthCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
