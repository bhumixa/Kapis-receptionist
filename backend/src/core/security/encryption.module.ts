import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/**
 * Standalone module (no dependency on anything else in `core/`) — same
 * shape as `AuditLogModule`, importable directly by any feature module that
 * needs to encrypt/decrypt a stored secret.
 */
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
