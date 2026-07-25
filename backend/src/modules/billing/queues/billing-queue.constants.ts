export const STRIPE_WEBHOOK_QUEUE = 'stripe-webhook';

export interface StripeWebhookJobData {
  webhookLogId: string;
}
