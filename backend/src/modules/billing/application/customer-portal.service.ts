import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntitlementService } from './entitlement.service';
import {
  callStripe,
  NoStripeSubscriptionException,
} from './exceptions/billing.exceptions';
import { StripeClient } from '../infrastructure/stripe-client';

/**
 * `POST /subscriptions/portal-session` (API_SPECIFICATION.md Section 13) —
 * a Stripe-hosted Customer Portal session for payment-method management and
 * invoice download, so this platform never builds its own card-entry UI
 * (keeps PCI scope at zero, matching SYSTEM_ARCHITECTURE.md Section 1.3's
 * Stripe-hosted-flows principle).
 */
@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly stripeClient: StripeClient,
    private readonly configService: ConfigService,
  ) {}

  async createPortalSession(tenantId: string): Promise<{ url: string }> {
    const { subscription } =
      await this.entitlements.getOrCreateForTenant(tenantId);
    if (!subscription.stripeCustomerId) {
      throw new NoStripeSubscriptionException();
    }

    return callStripe(() =>
      this.stripeClient.createPortalSession({
        stripeCustomerId: subscription.stripeCustomerId!,
        returnUrl: this.configService.getOrThrow<string>(
          'billing.portalReturnUrl',
        ),
      }),
    );
  }
}
