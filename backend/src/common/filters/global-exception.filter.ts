import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import {
  ERROR_CODES,
  HTTP_STATUS_TO_ERROR_CODE,
} from '../constants/error-codes.constant';
import { ErrorResponse } from '../interfaces/api-response.interface';

interface StructuredExceptionBody {
  code?: string;
  message?: string;
  details?: Array<Record<string, unknown>>;
}

/**
 * Catches every unhandled exception and maps it to the standard error
 * envelope (docs/API_SPECIFICATION.md Section 2.3), so no endpoint —
 * including ones not yet written — can leak a raw stack trace or Nest's
 * default error shape to a client.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, message, details } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId: request.requestId },
        `Unhandled exception: ${message}`,
      );
    } else {
      this.logger.warn(
        { requestId: request.requestId, code },
        `Request error: ${message}`,
      );
    }

    const body: ErrorResponse = {
      success: false,
      error: { code, message, details },
      requestId: request.requestId,
    };

    response.setHeader('X-Request-Id', request.requestId);
    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Array<Record<string, unknown>>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as StructuredExceptionBody;
        return {
          status,
          code:
            body.code ??
            HTTP_STATUS_TO_ERROR_CODE[status] ??
            ERROR_CODES.INTERNAL_ERROR,
          message: body.message ?? exception.message,
          details: body.details ?? [],
        };
      }

      return {
        status,
        code: HTTP_STATUS_TO_ERROR_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR,
        message: exception.message,
        details: [],
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
      details: [],
    };
  }
}
