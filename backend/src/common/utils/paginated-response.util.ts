/**
 * Marks a controller return value as a paginated list response
 * (docs/API_SPECIFICATION.md Section 2.2/2.4), so `ResponseTransformInterceptor`
 * hoists `meta` to the envelope's top level instead of nesting it inside
 * `data` like every other (non-paginated) controller return value.
 *
 * The Admin tenant list (Milestone 3) is this codebase's first list/
 * pagination endpoint — no prior convention existed to follow, so this is
 * the interceptor-level fix that makes every future list endpoint (staff,
 * employees, services, ...) get real `meta.pagination` for free rather than
 * repeating this problem per module.
 */
const PAGINATED_MARKER = Symbol('PAGINATED_RESPONSE');

export interface PaginatedPayload<T> {
  [PAGINATED_MARKER]: true;
  data: T;
  meta: Record<string, unknown>;
}

export function paginated<T>(
  data: T,
  meta: Record<string, unknown>,
): PaginatedPayload<T> {
  return { [PAGINATED_MARKER]: true, data, meta };
}

export function isPaginatedPayload(
  value: unknown,
): value is PaginatedPayload<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[PAGINATED_MARKER] === true
  );
}
