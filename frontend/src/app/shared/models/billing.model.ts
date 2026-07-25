/** Mirrors docs/API_SPECIFICATION.md Section 13's `PlanDTO`/`SubscriptionDTO`/`InvoiceDTO`. */
export type SubscriptionStatus =
  'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE' | 'UNPAID';

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

export type PaymentStatus = 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'REFUNDED';

export interface Plan {
  id: string;
  name: string;
  monthlyPriceCents: number;
  currency: string;
  maxStaff: number | null;
  maxMessagesPerMonth: number | null;
  maxLocations: number;
  maxAppointmentsPerMonth: number | null;
  maxStorageMb: number | null;
  isActive: boolean;
  trialDays: number;
}

export interface Subscription {
  id: string;
  planId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  messagesUsedCurrentPeriod: number;
  hasStripeSubscription: boolean;
}

export interface Invoice {
  id: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  status: InvoiceStatus;
  invoicePdfUrl: string | null;
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
}

export interface Payment {
  id: string;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  failureMessage: string | null;
  attemptedAt: string;
}

export interface TenantBillingSummary {
  subscription: Subscription;
  invoices: {
    items: Invoice[];
    page: number;
    pageSize: number;
    total: number;
  };
}
