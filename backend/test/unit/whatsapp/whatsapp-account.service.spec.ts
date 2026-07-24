import { RoleName, WhatsAppConnectionStatus } from '@prisma/client';
import { WhatsAppAccountService } from '../../../src/modules/whatsapp/application/whatsapp-account.service';
import {
  WhatsAppCloudApiClient,
  WhatsAppCloudApiError,
} from '../../../src/modules/whatsapp/infrastructure/whatsapp-cloud-api.client';
import { EncryptionService } from '../../../src/core/security/encryption.service';
import { AuditLogService } from '../../../src/core/audit/audit-log.service';
import { WhatsAppAccountRepositoryPort } from '../../../src/modules/whatsapp/domain/ports/whatsapp-account-repository.port';
import { WhatsAppAccountEntity } from '../../../src/modules/whatsapp/domain/entities/whatsapp-account.entity';
import {
  AccountAlreadyConnectedException,
  AccountNotConnectedException,
  InvalidWhatsAppCredentialsException,
  PhoneNumberIdAlreadyInUseException,
} from '../../../src/modules/whatsapp/application/exceptions/whatsapp.exceptions';

const ownerActor = {
  sub: 'user-owner',
  email: 'owner@bellasalon.com',
  tenantId: 'tenant-1',
  roles: [RoleName.OWNER],
};

function makeAccount(
  overrides: Partial<WhatsAppAccountEntity> = {},
): WhatsAppAccountEntity {
  return {
    id: 'account-1',
    tenantId: 'tenant-1',
    phoneNumber: '+15550001111',
    whatsappPhoneNumberId: 'phone-number-id-123',
    whatsappBusinessAccountId: 'business-account-1',
    accessTokenEncrypted: 'ciphertext',
    connectionStatus: WhatsAppConnectionStatus.CONNECTED,
    connectedAt: new Date(),
    disconnectedAt: null,
    lastHealthCheckAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('WhatsAppAccountService', () => {
  let accounts: jest.Mocked<WhatsAppAccountRepositoryPort>;
  let cloudApiClient: jest.Mocked<
    Pick<WhatsAppCloudApiClient, 'getPhoneNumberDetails'>
  >;
  let encryption: jest.Mocked<Pick<EncryptionService, 'encrypt' | 'decrypt'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let service: WhatsAppAccountService;

  beforeEach(() => {
    accounts = {
      findByTenantId: jest.fn(),
      findByPhoneNumberId: jest.fn(),
      create: jest.fn(),
      updateConnectionStatus: jest.fn(),
    };
    cloudApiClient = {
      getPhoneNumberDetails: jest
        .fn()
        .mockResolvedValue({ verified_name: 'Bella Salon' }),
    };
    encryption = {
      encrypt: jest.fn().mockReturnValue('ciphertext'),
      decrypt: jest.fn().mockReturnValue('plaintext-token'),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    service = new WhatsAppAccountService(
      accounts,
      cloudApiClient as unknown as WhatsAppCloudApiClient,
      encryption as unknown as EncryptionService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('connectAccount', () => {
    const input = {
      phoneNumber: '+15550001111',
      whatsappPhoneNumberId: 'phone-number-id-123',
      whatsappBusinessAccountId: 'business-account-1',
      accessToken: 'raw-access-token',
    };

    it('validates credentials against Meta, encrypts the token, and persists the account', async () => {
      accounts.findByTenantId.mockResolvedValue(null);
      accounts.findByPhoneNumberId.mockResolvedValue(null);
      accounts.create.mockResolvedValue(makeAccount());

      const result = await service.connectAccount(
        'tenant-1',
        ownerActor,
        input,
      );

      expect(cloudApiClient.getPhoneNumberDetails).toHaveBeenCalledWith(
        'raw-access-token',
        'phone-number-id-123',
      );
      expect(encryption.encrypt).toHaveBeenCalledWith('raw-access-token');
      expect(accounts.create).toHaveBeenCalledWith('tenant-1', {
        phoneNumber: input.phoneNumber,
        whatsappPhoneNumberId: input.whatsappPhoneNumberId,
        whatsappBusinessAccountId: input.whatsappBusinessAccountId,
        accessTokenEncrypted: 'ciphertext',
      });
      expect(result.connectionStatus).toBe(WhatsAppConnectionStatus.CONNECTED);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WHATSAPP_ACCOUNT_CONNECTED' }),
      );
    });

    it('rejects when the tenant already has a connected account', async () => {
      accounts.findByTenantId.mockResolvedValue(makeAccount());

      await expect(
        service.connectAccount('tenant-1', ownerActor, input),
      ).rejects.toThrow(AccountAlreadyConnectedException);
      expect(cloudApiClient.getPhoneNumberDetails).not.toHaveBeenCalled();
    });

    it('rejects when the phone number ID is already connected to another tenant', async () => {
      accounts.findByTenantId.mockResolvedValue(null);
      accounts.findByPhoneNumberId.mockResolvedValue(
        makeAccount({ tenantId: 'other-tenant' }),
      );

      await expect(
        service.connectAccount('tenant-1', ownerActor, input),
      ).rejects.toThrow(PhoneNumberIdAlreadyInUseException);
    });

    it('translates a Meta credential-verification failure into InvalidWhatsAppCredentialsException', async () => {
      accounts.findByTenantId.mockResolvedValue(null);
      accounts.findByPhoneNumberId.mockResolvedValue(null);
      cloudApiClient.getPhoneNumberDetails.mockRejectedValue(
        new WhatsAppCloudApiError('Invalid OAuth token', 401, {}),
      );

      await expect(
        service.connectAccount('tenant-1', ownerActor, input),
      ).rejects.toThrow(InvalidWhatsAppCredentialsException);
      expect(accounts.create).not.toHaveBeenCalled();
    });
  });

  describe('disconnectAccount', () => {
    it('marks the account DISCONNECTED and audit-logs', async () => {
      accounts.findByTenantId.mockResolvedValue(makeAccount());
      accounts.updateConnectionStatus.mockResolvedValue(
        makeAccount({
          connectionStatus: WhatsAppConnectionStatus.DISCONNECTED,
        }),
      );

      const result = await service.disconnectAccount('tenant-1', ownerActor);

      expect(result.connectionStatus).toBe(
        WhatsAppConnectionStatus.DISCONNECTED,
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WHATSAPP_ACCOUNT_DISCONNECTED' }),
      );
    });

    it('throws AccountNotConnectedException when there is nothing to disconnect', async () => {
      accounts.findByTenantId.mockResolvedValue(null);

      await expect(
        service.disconnectAccount('tenant-1', ownerActor),
      ).rejects.toThrow(AccountNotConnectedException);
    });
  });

  describe('getSendableAccount', () => {
    it('decrypts the access token only immediately before use', async () => {
      accounts.findByTenantId.mockResolvedValue(makeAccount());

      const result = await service.getSendableAccount('tenant-1');

      expect(encryption.decrypt).toHaveBeenCalledWith('ciphertext');
      expect(result).toEqual({
        whatsappPhoneNumberId: 'phone-number-id-123',
        accessToken: 'plaintext-token',
      });
    });

    it('throws AccountNotConnectedException when disconnected', async () => {
      accounts.findByTenantId.mockResolvedValue(
        makeAccount({
          connectionStatus: WhatsAppConnectionStatus.DISCONNECTED,
        }),
      );

      await expect(service.getSendableAccount('tenant-1')).rejects.toThrow(
        AccountNotConnectedException,
      );
    });

    it('throws AccountNotConnectedException when no account exists', async () => {
      accounts.findByTenantId.mockResolvedValue(null);

      await expect(service.getSendableAccount('tenant-1')).rejects.toThrow(
        AccountNotConnectedException,
      );
    });
  });
});
