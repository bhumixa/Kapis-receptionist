/**
 * Global reference data (Milestone 1) — not tenant-owned. `null` on any
 * `max*` field means unlimited for that dimension; `EntitlementService` is
 * the only place that interprets these limits (never a plan-name string
 * comparison anywhere else in the codebase — docs/FEATURE_ENTITLEMENTS.md).
 */
export interface PlanEntity {
  id: string;
  name: string;
  stripePriceId: string;
  monthlyPriceCents: number;
  currency: string;
  maxStaff: number | null;
  maxMessagesPerMonth: number | null;
  maxLocations: number;
  maxAppointmentsPerMonth: number | null;
  maxStorageMb: number | null;
  isActive: boolean;
  trialDays: number;
  createdAt: Date;
  updatedAt: Date;
}
