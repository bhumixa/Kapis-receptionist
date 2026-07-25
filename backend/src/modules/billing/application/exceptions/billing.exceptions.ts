import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StripeApiError } from '../../infrastructure/stripe-client';

/**
 * Typed, named business-rule exceptions (same convention as
 * `modules/whatsapp/application/exceptions/whatsapp.exceptions.ts`) — the
 * global exception filter maps these to API_SPECIFICATION.md Section 2.3's
 * envelope automatically via their structured body.
 */
export const BILLING_ERROR_CODES = {
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_ALREADY_ACTIVE_ON_PLAN: 'SUBSCRIPTION_ALREADY_ACTIVE_ON_PLAN',
  INVALID_COUPON: 'INVALID_COUPON',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
  INVALID_STRIPE_WEBHOOK_SIGNATURE: 'INVALID_STRIPE_WEBHOOK_SIGNATURE',
  NO_STRIPE_SUBSCRIPTION: 'NO_STRIPE_SUBSCRIPTION',
  SUBSCRIPTION_ALREADY_CANCELED: 'SUBSCRIPTION_ALREADY_CANCELED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
} as const;

export class PlanNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: BILLING_ERROR_CODES.PLAN_NOT_FOUND,
      message: 'Plan not found.',
      details: [],
    });
  }
}

export class SubscriptionNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      message: 'This tenant has no subscription.',
      details: [],
    });
  }
}

export class SubscriptionAlreadyActiveOnPlanException extends ConflictException {
  constructor() {
    super({
      code: BILLING_ERROR_CODES.SUBSCRIPTION_ALREADY_ACTIVE_ON_PLAN,
      message: 'The subscription is already active on this plan.',
      details: [],
    });
  }
}

export class InvalidCouponException extends UnprocessableEntityException {
  constructor(reason: string) {
    super({
      code: BILLING_ERROR_CODES.INVALID_COUPON,
      message: `This coupon cannot be applied: ${reason}`,
      details: [],
    });
  }
}

/**
 * `403 PLAN_LIMIT_EXCEEDED` — thrown by `EntitlementService.assertWithinLimit`
 * and caught by every consuming module (Employees, Appointments, AI/WhatsApp)
 * exactly like any other authorization failure; the `code` distinguishes it
 * from a role/permission `403` so the frontend can render an upgrade
 * prompt instead of a generic "access denied" message.
 */
export class PlanLimitExceededException extends ForbiddenException {
  constructor(feature: string, limit: number) {
    super({
      code: BILLING_ERROR_CODES.PLAN_LIMIT_EXCEEDED,
      message: `This action exceeds your plan's ${feature} limit (${limit}). Upgrade your plan to continue.`,
      details: [{ feature, limit }],
    });
  }
}

export class InvalidStripeWebhookSignatureException extends UnauthorizedException {
  constructor() {
    super({
      code: BILLING_ERROR_CODES.INVALID_STRIPE_WEBHOOK_SIGNATURE,
      message: 'Stripe webhook signature verification failed.',
      details: [],
    });
  }
}

/** A tenant tries to manage billing (portal/plan change/cancel) before ever completing Checkout. */
export class NoStripeSubscriptionException extends UnprocessableEntityException {
  constructor() {
    super({
      code: BILLING_ERROR_CODES.NO_STRIPE_SUBSCRIPTION,
      message:
        'This subscription has no associated Stripe subscription yet — complete checkout first.',
      details: [],
    });
  }
}

export class SubscriptionAlreadyCanceledException extends ConflictException {
  constructor() {
    super({
      code: BILLING_ERROR_CODES.SUBSCRIPTION_ALREADY_CANCELED,
      message: 'This subscription is already canceled or scheduled to cancel.',
      details: [],
    });
  }
}

/**
 * `503 UPSTREAM_UNAVAILABLE` (API_SPECIFICATION.md Section 2.3's global
 * error-code table already reserves this for third-party outages) — the
 * platform-facing shape for any `StripeApiError` (`infrastructure/
 * stripe-client.ts`), so a Stripe outage/misconfiguration (invalid API
 * key, network failure, rate limit) never surfaces to a caller as a bare,
 * unclassified `500`. Live-verified against a real running backend with an
 * intentionally invalid Stripe key: `POST /subscriptions` correctly
 * returned this instead of an opaque `Internal Server Error`.
 */
export class StripeUnavailableException extends ServiceUnavailableException {
  constructor(cause: StripeApiError) {
    super({
      code: BILLING_ERROR_CODES.UPSTREAM_UNAVAILABLE,
      message:
        'Stripe is temporarily unavailable. Please try again in a moment.',
      details: [{ stripeType: cause.stripeType }],
    });
  }
}

/**
 * Every `CheckoutService`/`CustomerPortalService`/`SubscriptionsService`
 * method that calls `StripeClient` wraps the call with this — catches the
 * infrastructure-layer `StripeApiError` and rethrows it as the platform's
 * own typed HTTP exception, keeping "translate a third-party SDK error
 * into this API's error contract" in one place rather than duplicated
 * per call site.
 */
export async function callStripe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StripeApiError) {
      throw new StripeUnavailableException(error);
    }
    throw error;
  }
}
