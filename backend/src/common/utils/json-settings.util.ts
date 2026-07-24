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

/**
 * String/boolean/nested-object variants added Milestone 8
 * (docs/AI_ARCHITECTURE.md) — `general.ai.*` (greeting message, tone,
 * escalation instructions, enabled toggle, confidence threshold) is the
 * first namespace consumer needing all three, `readNumberSetting` being the
 * only reader that existed before.
 */
export function readStringSetting(
  namespace: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = namespace[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function readBooleanSetting(
  namespace: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = namespace[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** Reads a nested namespace (e.g. `general.ai`) as a plain object, tolerating a missing/malformed key. */
export function readObjectSetting(
  namespace: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = namespace[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
