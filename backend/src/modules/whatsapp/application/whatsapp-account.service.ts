import { Inject, Injectable } from '@nestjs/common';
import { ActorType, WhatsAppConnectionStatus } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { EncryptionService } from '../../../core/security/encryption.service';
import { AccessTokenPayload } from '../../auth/application/token.service';
import { WhatsAppAccountEntity } from '../domain/entities/whatsapp-account.entity';
import {
  WHATSAPP_ACCOUNT_REPOSITORY,
  type WhatsAppAccountRepositoryPort,
} from '../domain/ports/whatsapp-account-repository.port';
import {
  AccountAlreadyConnectedException,
  AccountNotConnectedException,
  InvalidWhatsAppCredentialsException,
  PhoneNumberIdAlreadyInUseException,
} from './exceptions/whatsapp.exceptions';
import {
  WhatsAppCloudApiClient,
  WhatsAppCloudApiError,
} from '../infrastructure/whatsapp-cloud-api.client';

export interface ConnectAccountInput {
  phoneNumber: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  accessToken: string;
}

/** What `OutboundMessageService` needs to actually place a call to Meta. */
export interface SendableAccount {
  whatsappPhoneNumberId: string;
  accessToken: string;
}

/**
 * `GET/POST/DELETE /whatsapp/account` (API_SPECIFICATION.md Section 11) —
 * `whatsapp:manage` permission, OWNER/MANAGER only (docs/WHATSAPP_
 * ARCHITECTURE.md), matching the sensitivity level of other account-level
 * integrations rather than every tenant-scoped write.
 */
@Injectable()
export class WhatsAppAccountService {
  constructor(
    @Inject(WHATSAPP_ACCOUNT_REPOSITORY)
    private readonly accounts: WhatsAppAccountRepositoryPort,
    private readonly cloudApiClient: WhatsAppCloudApiClient,
    private readonly encryption: EncryptionService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getAccount(tenantId: string): Promise<WhatsAppAccountEntity | null> {
    return this.accounts.findByTenantId(tenantId);
  }

  async connectAccount(
    tenantId: string,
    actor: AccessTokenPayload,
    input: ConnectAccountInput,
  ): Promise<WhatsAppAccountEntity> {
    const existing = await this.accounts.findByTenantId(tenantId);
    if (existing) {
      throw new AccountAlreadyConnectedException();
    }

    const inUse = await this.accounts.findByPhoneNumberId(
      input.whatsappPhoneNumberId,
    );
    if (inUse) {
      throw new PhoneNumberIdAlreadyInUseException();
    }

    // Verify the credentials actually work against Meta before persisting
    // them as CONNECTED — catches a typo'd phone-number-ID or an
    // already-revoked token at connect time, not on the first real send.
    try {
      await this.cloudApiClient.getPhoneNumberDetails(
        input.accessToken,
        input.whatsappPhoneNumberId,
      );
    } catch (error) {
      if (error instanceof WhatsAppCloudApiError) {
        throw new InvalidWhatsAppCredentialsException(error.message);
      }
      throw error;
    }

    const account = await this.accounts.create(tenantId, {
      phoneNumber: input.phoneNumber,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      whatsappBusinessAccountId: input.whatsappBusinessAccountId,
      accessTokenEncrypted: this.encryption.encrypt(input.accessToken),
    });

    await this.auditLog.record({
      action: 'WHATSAPP_ACCOUNT_CONNECTED',
      entityType: 'WhatsAppAccount',
      entityId: account.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { whatsappPhoneNumberId: input.whatsappPhoneNumberId },
    });

    return account;
  }

  async disconnectAccount(
    tenantId: string,
    actor: AccessTokenPayload,
  ): Promise<WhatsAppAccountEntity> {
    const existing = await this.accounts.findByTenantId(tenantId);
    if (!existing) {
      throw new AccountNotConnectedException();
    }

    const account = await this.accounts.updateConnectionStatus(
      tenantId,
      WhatsAppConnectionStatus.DISCONNECTED,
      { disconnectedAt: new Date() },
    );

    await this.auditLog.record({
      action: 'WHATSAPP_ACCOUNT_DISCONNECTED',
      entityType: 'WhatsAppAccount',
      entityId: account.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: {},
    });

    return account;
  }

  /** Used by `OutboundMessageService` — decrypts the access token only immediately before a Cloud API call. */
  async getSendableAccount(tenantId: string): Promise<SendableAccount> {
    const account = await this.accounts.findByTenantId(tenantId);
    if (
      !account ||
      account.connectionStatus !== WhatsAppConnectionStatus.CONNECTED
    ) {
      throw new AccountNotConnectedException();
    }
    return {
      whatsappPhoneNumberId: account.whatsappPhoneNumberId,
      accessToken: this.encryption.decrypt(account.accessTokenEncrypted),
    };
  }
}
