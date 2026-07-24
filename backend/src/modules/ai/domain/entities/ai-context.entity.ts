/**
 * Per-conversation working state the AI needs across turns beyond raw
 * message history (SYSTEM_ARCHITECTURE.md 5.2/5.5) — e.g. "customer is
 * mid-booking-flow, has selected service X, awaiting time confirmation."
 * `state` is explicitly untyped JSON (docs/adr/ADR-011-ai-receptionist.md,
 * matching PRISMA_SCHEMA.md's original design intent): its shape evolves as
 * tools evolve, and it is ephemeral working memory, not a durable business
 * record. A Redis cache (`ai:context:{conversationId}`) sits in front of
 * this durable row (DATABASE_DESIGN.md 10.2) — this entity is always the
 * source of truth, the cache purely a latency optimization.
 */
export interface AIContextEntity {
  id: string;
  tenantId: string;
  conversationId: string;
  currentIntent: string | null;
  state: Record<string, unknown>;
  lastToolCall: string | null;
  updatedAt: Date;
}
