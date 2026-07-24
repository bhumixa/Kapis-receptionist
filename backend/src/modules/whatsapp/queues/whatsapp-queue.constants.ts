export const WHATSAPP_INBOUND_QUEUE = 'whatsapp-inbound';
export const WHATSAPP_OUTBOUND_QUEUE = 'whatsapp-outbound';

export interface InboundWebhookJobData {
  webhookEventId: string;
}

export interface OutboundMessageJobData {
  tenantId: string;
  messageId: string;
}
