import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { resolveRequestId } from '../utils/request-id.util';

declare module 'express' {
  interface Request {
    requestId: string;
  }
}

/**
 * Resolves this request's correlation ID (docs/API_SPECIFICATION.md Section
 * 2.9) before anything else runs, so every downstream logger, interceptor,
 * and exception filter can rely on `req.requestId` already being set.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.headers['x-request-id']);
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
