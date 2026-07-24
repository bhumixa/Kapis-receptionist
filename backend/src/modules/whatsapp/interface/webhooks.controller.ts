import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { WebhookIngestionService } from '../application/webhook-ingestion.service';

/**
 * `GET/POST /webhooks/whatsapp` (API_SPECIFICATION.md Section 11,
 * SYSTEM_ARCHITECTURE.md Section 6.1/6.9) — called by Meta, not by any
 * authenticated user, so this controller carries none of the usual
 * `JwtAuthGuard`/`RolesGuard`/`TenantScopedGuard` stack. Trust is
 * established entirely via `X-Hub-Signature-256` verification
 * (`WebhookIngestionService.ingest`), the webhook-specific tenant-
 * resolution path documented in docs/adr/ADR-010-whatsapp-platform.md as a
 * deliberate exception to `TenantContextService` being the sole resolver
 * everywhere else in this app. Excluded from Swagger (not part of the
 * platform's own client-facing contract) and from the versioned `/api/v1`
 * prefix (main.ts) and the success-response envelope
 * (`ResponseTransformInterceptor`) — Meta expects a raw challenge echo on
 * `GET` and an empty `200` on `POST`, not this platform's JSON envelope.
 */
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WebhooksController {
  constructor(private readonly webhookIngestion: WebhookIngestionService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    const result = this.webhookIngestion.handleVerification(
      mode,
      token,
      challenge,
    );
    res.status(HttpStatus.OK).send(result);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    await this.webhookIngestion.ingest(
      req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
      req.header('X-Hub-Signature-256'),
    );
    res.status(HttpStatus.OK).send();
  }
}
