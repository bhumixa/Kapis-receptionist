import {
  buildCursorPage,
  cursorWhereClause,
  decodeCursor,
  encodeCursor,
} from '../../../src/common/utils/cursor-pagination.util';

describe('cursor-pagination util', () => {
  it('round-trips encode/decode for a Date sort value', () => {
    const date = new Date('2026-08-01T10:00:00.000Z');
    const cursor = encodeCursor(date, 'row-1');
    const decoded = decodeCursor(cursor);

    expect(decoded).toEqual({ v: date.toISOString(), id: 'row-1' });
  });

  it('throws CursorExpiredException for a malformed cursor', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow();
  });

  it('builds an ascending keyset OR-clause', () => {
    const cursor = { v: '2026-08-01T10:00:00.000Z', id: 'row-1' };
    const clause = cursorWhereClause('startTime', 'asc', cursor);

    expect(clause).toEqual({
      OR: [
        { startTime: { gt: cursor.v } },
        { startTime: cursor.v, id: { gt: cursor.id } },
      ],
    });
  });

  it('builds a descending keyset OR-clause', () => {
    const cursor = { v: '2026-08-01T10:00:00.000Z', id: 'row-1' };
    const clause = cursorWhereClause('startTime', 'desc', cursor);

    expect(clause).toEqual({
      OR: [
        { startTime: { lt: cursor.v } },
        { startTime: cursor.v, id: { lt: cursor.id } },
      ],
    });
  });

  it('returns an empty clause when there is no cursor (first page)', () => {
    expect(cursorWhereClause('startTime', 'asc', null)).toEqual({});
  });

  it('splits off the lookahead row and reports hasMore/nextCursor', () => {
    const rows = [
      { id: 'a', startTime: new Date('2026-08-01T09:00:00Z') },
      { id: 'b', startTime: new Date('2026-08-01T10:00:00Z') },
      { id: 'c', startTime: new Date('2026-08-01T11:00:00Z') },
    ];

    const page = buildCursorPage(rows, 2, 'startTime');

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor!)).toEqual({
      v: rows[1].startTime.toISOString(),
      id: 'b',
    });
  });

  it('reports hasMore=false and nextCursor=null when there is no lookahead row', () => {
    const rows = [{ id: 'a', startTime: new Date('2026-08-01T09:00:00Z') }];
    const page = buildCursorPage(rows, 20, 'startTime');

    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual(rows);
  });
});
