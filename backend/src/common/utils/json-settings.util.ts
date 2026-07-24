/**
 * Safe field access into `TenantSettings`' namespaced JSON blobs
 * (docs/TENANT_ARCHITECTURE.md) — no namespace has a fixed field schema, so
 * every reader must tolerate a missing/malformed key rather than throw.
 * First real consumer: `modules/availability`/`modules/appointments`
 * reading `business.bookingBufferMinutes`/`business.cancellationNoticeHours`
 * (Milestone 6, docs/adr/ADR-009-scheduling-engine.md) — the `business`
 * namespace's first populated fields.
 */
export function readNumberSetting(
  namespace: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = namespace[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
