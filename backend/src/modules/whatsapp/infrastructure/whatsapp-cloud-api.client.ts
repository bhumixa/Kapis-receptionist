import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin HTTP wrapper over Meta's WhatsApp Business Cloud API (Graph API).
 * `statusCode` lets callers (the outbound-send processor) distinguish
 * transient failures (5xx, 429 — worth a BullMQ retry) from permanent ones
 * (4xx — invalid recipient, expired token, outside-window rejection from
 * Meta's own side — not worth retrying, surface to staff instead),
 * mirroring the retry-classification precedent SYSTEM_ARCHITECTURE.md
 * Section 6.5 documents for outbound sends.
 */
export class WhatsAppCloudApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
  }

  get isTransient(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

export interface SendTextMessageResult {
  whatsappMessageId: string;
}

@Injectable()
export class WhatsAppCloudApiClient {
  private readonly logger = new Logger(WhatsAppCloudApiClient.name);
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.getOrThrow<string>(
      'whatsapp.graphApiBaseUrl',
    );
  }

  /** Sends a free-form text message. Rejected by Meta with a 4xx if outside the 24h customer-service window and no template is used (no template support this milestone). */
  async sendTextMessage(
    accessToken: string,
    whatsappPhoneNumberId: string,
    to: string,
    body: string,
  ): Promise<SendTextMessageResult> {
    const response = await this.post(accessToken, whatsappPhoneNumberId, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
    const whatsappMessageId = (
      response as { messages?: Array<{ id?: string }> }
    )?.messages?.[0]?.id;
    if (!whatsappMessageId) {
      throw new WhatsAppCloudApiError(
        'WhatsApp Cloud API response missing message id',
        502,
        response,
      );
    }
    return { whatsappMessageId };
  }

  /**
   * Validates a phone-number-ID/access-token pair against Meta during the
   * account-connect flow, before persisting the connection as CONNECTED —
   * catches a typo'd ID or an already-revoked token immediately rather than
   * discovering it on the first real outbound send.
   */
  async getPhoneNumberDetails(
    accessToken: string,
    whatsappPhoneNumberId: string,
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/${whatsappPhoneNumberId}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await this.safeJson(response);
    if (!response.ok) {
      throw new WhatsAppCloudApiError(
        `WhatsApp Cloud API rejected phone number verification (${response.status})`,
        response.status,
        body,
      );
    }
    return body as Record<string, unknown>;
  }

  private async post(
    accessToken: string,
    whatsappPhoneNumberId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}/${whatsappPhoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await this.safeJson(response);
    if (!response.ok) {
      this.logger.warn(
        `WhatsApp Cloud API send failed (${response.status}): ${JSON.stringify(body)}`,
      );
      throw new WhatsAppCloudApiError(
        `WhatsApp Cloud API send failed (${response.status})`,
        response.status,
        body,
      );
    }
    return body;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
