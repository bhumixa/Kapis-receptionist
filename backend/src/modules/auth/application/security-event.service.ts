import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

export type SecurityEventType =
  | 'REGISTER'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'REFRESH_SUCCESS'
  | 'REFRESH_FAILURE'
  | 'REFRESH_TOKEN_REUSE_DETECTED';

export interface SecurityEventContext {
  userId?: string;
  tenantId?: string | null;
  email?: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  [key: string]: unknown;
}

/**
 * Reusable security-event logging service. Deliberately **not** a new
 * persisted database table this sprint — `AuditLog` is explicit Milestone 9
 * scope (PRISMA_SCHEMA.md Section 11) and adding it now would be exactly
 * the kind of forward-reference this project's incremental-migration
 * discipline avoids (ADR-001/ADR-002 precedent). Instead, every security
 * event is a structured, tagged log line (SYSTEM_ARCHITECTURE.md Section
 * 10.9), consistent with Section 12.7's logging standards — searchable in
 * the centralized log aggregator today, and trivially replayable into a
 * real `AuditLog`/`SecurityEvent` table once Milestone 9 builds it, since
 * the event shape is already well-defined here.
 */
@Injectable()
export class SecurityEventService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(SecurityEventService.name);
  }

  record(type: SecurityEventType, context: SecurityEventContext = {}): void {
    const isFailureOrThreat =
      type === 'LOGIN_FAILURE' ||
      type === 'REFRESH_FAILURE' ||
      type === 'REFRESH_TOKEN_REUSE_DETECTED';

    if (isFailureOrThreat) {
      this.logger.warn({ securityEvent: type, ...context }, type);
    } else {
      this.logger.info({ securityEvent: type, ...context }, type);
    }
  }
}
