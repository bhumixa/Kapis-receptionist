import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Typed, named business-rule exceptions (same convention as
 * `modules/customers/application/exceptions/customer.exceptions.ts`) — the
 * global exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const WHATSAPP_ERROR_CODES = {
  ACCOUNT_ALREADY_CONNECTED: 'ACCOUNT_ALREADY_CONNECTED',
  ACCOUNT_NOT_CONNECTED: 'ACCOUNT_NOT_CONNECTED',
  PHONE_NUMBER_ID_ALREADY_IN_USE: 'PHONE_NUMBER_ID_ALREADY_IN_USE',
  INVALID_WHATSAPP_CREDENTIALS: 'INVALID_WHATSAPP_CREDENTIALS',
  OUTSIDE_MESSAGING_WINDOW: 'OUTSIDE_MESSAGING_WINDOW',
  INVALID_WEBHOOK_SIGNATURE: 'INVALID_WEBHOOK_SIGNATURE',
  INVALID_VERIFY_TOKEN: 'INVALID_VERIFY_TOKEN',
} as const;

export class AccountAlreadyConnectedException extends ConflictException {
  constructor() {
    super({
      code: WHATSAPP_ERROR_CODES.ACCOUNT_ALREADY_CONNECTED,
      message: 'This tenant already has a connected WhatsApp account.',
      details: [],
    });
  }
}

export class AccountNotConnectedException extends BadRequestException {
  constructor() {
    super({
      code: WHATSAPP_ERROR_CODES.ACCOUNT_NOT_CONNECTED,
      message: 'This tenant has no connected WhatsApp account.',
      details: [],
    });
  }
}

export class PhoneNumberIdAlreadyInUseException extends ConflictException {
  constructor() {
    super({
      code: WHATSAPP_ERROR_CODES.PHONE_NUMBER_ID_ALREADY_IN_USE,
      message:
        'This WhatsApp phone number is already connected to another tenant.',
      details: [],
    });
  }
}

export class InvalidWhatsAppCredentialsException extends BadRequestException {
  constructor(reason: string) {
    super({
      code: WHATSAPP_ERROR_CODES.INVALID_WHATSAPP_CREDENTIALS,
      message: `Meta rejected these WhatsApp credentials: ${reason}`,
      details: [],
    });
  }
}

/**
 * `422 OUTSIDE_MESSAGING_WINDOW` (API_SPECIFICATION.md Section 11) — a
 * manual reply more than 24 hours after the customer's last inbound message
 * with no `TemplateMessage` support this milestone (deliberately deferred,
 * docs/adr/ADR-010-whatsapp-platform.md) to fall back on.
 */
export class OutsideMessagingWindowException extends UnprocessableEntityException {
  constructor() {
    super({
      code: WHATSAPP_ERROR_CODES.OUTSIDE_MESSAGING_WINDOW,
      message:
        'More than 24 hours have passed since the customer last messaged; a free-form reply cannot be sent.',
      details: [],
    });
  }
}

export class InvalidWebhookSignatureException extends UnauthorizedException {
  constructor() {
    super({
      code: WHATSAPP_ERROR_CODES.INVALID_WEBHOOK_SIGNATURE,
      message: 'Webhook signature verification failed.',
      details: [],
    });
  }
}

export class InvalidVerifyTokenException extends UnauthorizedException {
  constructor() {
    super({
      code: WHATSAPP_ERROR_CODES.INVALID_VERIFY_TOKEN,
      message: 'Webhook verification token mismatch.',
      details: [],
    });
  }
}
