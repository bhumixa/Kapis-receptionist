import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * Standalone module (no dependency on `AuthModule`/`TenantsModule`) so it
 * can be imported anywhere — including from `CoreModule` itself, where
 * `TenantContextService` needs it to record impersonation events — without
 * contributing to the `CoreModule` <-> `AuthModule` circular-import problem
 * `core.module.ts` already documents.
 */
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
