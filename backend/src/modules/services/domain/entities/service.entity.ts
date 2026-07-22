/**
 * The salon's bookable service catalog entry (FR-5) — the structured data
 * later milestones' Availability engine and AI recommendation rely on.
 * `bufferTimeMinutes` (Milestone 5, docs/adr/ADR-008) is a new, per-service
 * cleanup/prep buffer, distinct from the tenant-wide `TenantSettings.
 * business.bookingBufferMinutes` reserved for the future Availability engine.
 */
export interface ServiceEntity {
  id: string;
  tenantId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  bufferTimeMinutes: number;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
