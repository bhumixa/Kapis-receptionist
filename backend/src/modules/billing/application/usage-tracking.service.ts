import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepositoryPort,
} from '../domain/ports/subscription-repository.port';

/**
 * Owns billing-period usage-counter *rollover* — incrementing during normal
 * traffic is `EntitlementService.checkAndIncrementAiMessageUsage`'s job
 * (the check and the increment must be one atomic call site so a request
 * can't slip through between them); this service only resets the counter
 * back to zero when a new billing period starts, called by
 * `StripeEventProcessorService` on `invoice.paid`.
 */
@Injectable()
export class UsageTrackingService {
  private readonly logger = new Logger(UsageTrackingService.name);

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: SubscriptionRepositoryPort,
  ) {}

  async resetPeriodUsage(tenantId: string): Promise<void> {
    await this.subscriptions.resetMessagesUsed(tenantId);
    this.logger.log(
      `Reset billing-period usage counters for tenant ${tenantId}`,
    );
  }
}
