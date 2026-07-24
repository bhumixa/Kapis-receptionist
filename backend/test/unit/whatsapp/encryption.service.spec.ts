import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  EncryptionService,
  InvalidEncryptionKeyException,
} from '../../../src/core/security/encryption.service';

function makeConfigService(key: string): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue(key),
  } as unknown as ConfigService;
}

describe('EncryptionService', () => {
  it('round-trips a plaintext value with a valid 32-byte key', () => {
    const key = randomBytes(32).toString('base64');
    const service = new EncryptionService(makeConfigService(key));
    service.onModuleInit();

    const ciphertext = service.encrypt('my-secret-access-token');

    expect(ciphertext).not.toEqual('my-secret-access-token');
    expect(service.decrypt(ciphertext)).toBe('my-secret-access-token');
  });

  it('produces different ciphertext for the same plaintext on each call (random IV)', () => {
    const key = randomBytes(32).toString('base64');
    const service = new EncryptionService(makeConfigService(key));
    service.onModuleInit();

    const first = service.encrypt('token');
    const second = service.encrypt('token');

    expect(first).not.toEqual(second);
    expect(service.decrypt(first)).toBe('token');
    expect(service.decrypt(second)).toBe('token');
  });

  it('throws InvalidEncryptionKeyException at init when the key is not 32 bytes', () => {
    const tooShortKey = Buffer.from('short').toString('base64');
    const service = new EncryptionService(makeConfigService(tooShortKey));

    expect(() => service.onModuleInit()).toThrow(InvalidEncryptionKeyException);
  });

  it('fails to decrypt ciphertext produced under a different key (auth tag mismatch)', () => {
    const serviceA = new EncryptionService(
      makeConfigService(randomBytes(32).toString('base64')),
    );
    serviceA.onModuleInit();
    const serviceB = new EncryptionService(
      makeConfigService(randomBytes(32).toString('base64')),
    );
    serviceB.onModuleInit();

    const ciphertext = serviceA.encrypt('token');

    expect(() => serviceB.decrypt(ciphertext)).toThrow();
  });
});
