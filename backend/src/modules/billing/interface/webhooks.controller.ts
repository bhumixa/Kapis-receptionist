import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhookIngestionService } from '../application/webhook-ingestion.service';

/**
 * `POST /stripe/webhook` (API_SPECIFICATION.md Section 2.12/13) — called by
 * Stripe, not by any authenticated user, so this controller carries none of
 * the usual `JwtAuthGuard`/`RolesGuard`/`TenantScopedGuard` stack. Trust is
 * established entirely via `Stripe-Signature` verification
 * (`WebhookIngestionService.ingest`, using the Stripe SDK's own
 * `constructEvent`). Excluded from Swagger and from the versioned `/api/v1`
 * prefix + success-envelope wrapping (`main.ts`) — mirrors `POST
 * /webhooks/whatsapp`'s exact treatment. Stripe expects a fast empty `200`,
 * not this platform's JSON envelope, and retries on timeout/non-2xx.
 */
@ApiExcludeController()
@Controller('stripe/webhook')
export class WebhooksController {
  constructor(private readonly webhookIngestion: WebhookIngestionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<void> {
    await this.webhookIngestion.ingest(
      req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
      req.header('Stripe-Signature'),
    );
  }
}
