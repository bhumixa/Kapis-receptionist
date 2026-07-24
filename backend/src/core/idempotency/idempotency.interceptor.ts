import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Response } from 'express';
import { RedisService } from '../../database/redis.service';
import { TenantContextService } from '../context/tenant-context.service';
import type { AuthenticatedRequest } from '../../modules/auth/interface/types/authenticated-request.interface';

const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

interface StoredIdempotentResponse {
  requestHash: string;
  statusCode: number;
  body: unknown;
}

/**
 * Generic Idempotency-Key handling (API_SPECIFICATION.md Section 2.13),
 * built once here and reused by every endpoint that opts in via
 * `@UseInterceptors(IdempotencyInterceptor)` — `modules/appointments`'
 * `POST /appointments`, `.../cancel`, `.../reschedule` are its first
 * consumers (docs/adr/ADR-009-scheduling-engine.md). The roadmap explicitly
 * asks for this to be "implemented once, generically... reused by every
 * future idempotency-required endpoint", not reimplemented per module.
 *
 * Storage: `idempotency:{tenantId}:{key}` in Redis, 24h TTL — holds a hash
 * of the request body (to detect the "same key reused with a different
 * payload" misuse case, API_SPECIFICATION.md Section 2.3.1's `CONFLICT`)
 * plus the original response, so a retry with an identical payload replays
 * the exact prior response (status code included) instead of re-executing
 * the handler — critical for the booking-critical endpoints this guards,
 * where re-execution could create a second appointment for one customer
 * action.
 *
 * Registered per-method (not globally): most endpoints in this API have no
 * side effect worth this overhead (API_SPECIFICATION.md Section 2.13 only
 * requires it on a specific, named set of write endpoints).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly redis: RedisService,
    private readonly tenantContext: TenantContextService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<AuthenticatedRequest>();
    const response = httpContext.getResponse<Response>();

    const idempotencyKeyHeader = request.headers['idempotency-key'];
    if (!idempotencyKeyHeader || typeof idempotencyKeyHeader !== 'string') {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'An Idempotency-Key header is required for this request.',
        details: [],
      });
    }

    const tenantId = await this.tenantContext.requireTenantId();
    const redisKey = `idempotency:${tenantId}:${idempotencyKeyHeader}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    const existingRaw = await this.redis.get(redisKey);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as StoredIdempotentResponse;
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message:
            'This Idempotency-Key was already used with a different request payload.',
          details: [],
        });
      }
      response.status(existing.statusCode);
      return of(existing.body);
    }

    const intendedStatusCode =
      this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ??
      200;

    return next.handle().pipe(
      tap((body: unknown) => {
        const toStore: StoredIdempotentResponse = {
          requestHash,
          statusCode: intendedStatusCode,
          body,
        };
        void this.redis.set(
          redisKey,
          JSON.stringify(toStore),
          'EX',
          IDEMPOTENCY_TTL_SECONDS,
        );
      }),
    );
  }
}
