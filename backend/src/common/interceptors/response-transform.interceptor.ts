import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SuccessResponse } from '../interfaces/api-response.interface';

/**
 * Wraps every controller return value in the standard success envelope
 * (docs/API_SPECIFICATION.md Section 2.2), so individual controllers just
 * return their resource — never the envelope itself.
 */
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  SuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();

    // Health endpoints are infra-level (Docker healthcheck, uptime probes),
    // never called through the versioned API client, so they intentionally
    // return their own plain shape rather than the API success envelope.
    if (request.path.startsWith('/health')) {
      return next.handle() as unknown as Observable<SuccessResponse<T>>;
    }

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        meta: null,
        message: null,
        requestId: request.requestId,
      })),
    );
  }
}
