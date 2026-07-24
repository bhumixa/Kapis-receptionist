import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;

/**
 * Thrown at bootstrap if `WHATSAPP_TOKEN_ENCRYPTION_KEY` doesn't decode to
 * exactly 32 bytes — fail-fast (SYSTEM_ARCHITECTURE.md Section 10.6), same
 * discipline as `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, rather than a
 * confusing crypto error the first time a token is encrypted at request time.
 */
export class InvalidEncryptionKeyException extends Error {
  constructor() {
    super(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64) — generate with `openssl rand -base64 32`.',
    );
  }
}

/**
 * Generic AES-256-GCM encrypt/decrypt (core/security, not whatsapp-specific
 * despite its first consumer being `WhatsAppAccount.accessTokenEncrypted`)
 * — the first *decryptable* secret this codebase stores. Every other stored
 * secret (passwordHash, refreshTokenHash, tokenHash) is one-way hashed,
 * which doesn't work here: outbound WhatsApp Cloud API calls need the raw
 * access token back.
 *
 * Ciphertext format is a single base64 string: `iv (12 bytes) || authTag (16
 * bytes) || ciphertext`, so callers store/read one column, not three.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const rawKey = this.configService.getOrThrow<string>(
      'whatsapp.tokenEncryptionKey',
    );
    const decoded = Buffer.from(rawKey, 'base64');
    if (decoded.length !== KEY_LENGTH_BYTES) {
      throw new InvalidEncryptionKeyException();
    }
    this.key = decoded;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(encoded: string): string {
    const raw = Buffer.from(encoded, 'base64');
    const iv = raw.subarray(0, IV_LENGTH_BYTES);
    const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + 16);
    const ciphertext = raw.subarray(IV_LENGTH_BYTES + 16);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
