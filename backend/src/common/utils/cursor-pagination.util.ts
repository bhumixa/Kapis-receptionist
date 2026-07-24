import { BadRequestException } from '@nestjs/common';

/**
 * Generic keyset (cursor) pagination helpers (API_SPECIFICATION.md Section
 * 2.4.1) — built once here, first consumed by `modules/customers` and
 * `modules/appointments` (Milestone 6, docs/adr/ADR-009-scheduling-engine.md),
 * reused by any future high-volume list endpoint the standing "no offset
 * pagination" rule applies to (`messages`, `conversations`, ...).
 *
 * The cursor encodes the last-seen `(sortValue, id)` pair; clients must treat
 * it as opaque (Section 2.4.1). Prisma has no native row-wise tuple
 * comparison, so the keyset condition is expressed as the standard
 * `(field > v) OR (field = v AND id > id)` OR-expansion (flipped to `<` for
 * descending sort) — `id` is the tiebreaker for rows that share a sort value.
 */

export interface CursorPayload {
  v: string | number;
  id: string;
}

export class CursorExpiredException extends BadRequestException {
  constructor() {
    super({
      code: 'CURSOR_EXPIRED',
      message:
        'This cursor is invalid or has expired. Restart from the first page.',
      details: [],
    });
  }
}

export function encodeCursor(
  sortValue: Date | string | number,
  id: string,
): string {
  const v = sortValue instanceof Date ? sortValue.toISOString() : sortValue;
  const payload: CursorPayload = { v, id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as CursorPayload;
    if (typeof decoded.id !== 'string' || decoded.v === undefined) {
      throw new Error('malformed cursor payload');
    }
    return decoded;
  } catch {
    throw new CursorExpiredException();
  }
}

export function cursorWhereClause(
  sortField: string,
  sortDirection: 'asc' | 'desc',
  cursor: CursorPayload | null,
): Record<string, unknown> {
  if (!cursor) {
    return {};
  }
  const op = sortDirection === 'asc' ? 'gt' : 'lt';
  return {
    OR: [
      { [sortField]: { [op]: cursor.v } },
      { [sortField]: cursor.v, id: { [op]: cursor.id } },
    ],
  };
}

export interface CursorPageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Given `limit + 1` rows fetched ordered by `(sortField, id)`, splits off the
 * lookahead row and builds the next cursor from the last row actually
 * returned.
 */
export function buildCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortField: keyof T,
): CursorPageResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor(last[sortField] as unknown as string | Date, last.id)
      : null;
  return { items, nextCursor, hasMore };
}
