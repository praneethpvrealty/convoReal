import { describe, expect, it } from 'vitest';

import {
  nextKeysetCursor,
  nextOffset,
  olderThanCursor,
  uniqueById,
} from './list-paging';

describe('[UIX-009] list paging', () => {
  it('asks for another thread page only when the last one was full', () => {
    const rows = [
      { id: 'b', created_at: '2026-10-31T10:00:00+00:00' },
      { id: 'a', created_at: '2026-10-31T09:00:00+00:00' },
    ];
    expect(nextKeysetCursor(rows, 2)).toEqual(rows[1]);
    expect(nextKeysetCursor(rows, 3)).toBeUndefined();
    expect(nextKeysetCursor([], 3)).toBeUndefined();
  });

  it('pages older messages with an id tiebreak, quoting the timestamp', () => {
    expect(
      olderThanCursor({ created_at: '2026-10-31T09:00:00+00:00', id: 'm1' })
    ).toBe(
      'created_at.lt."2026-10-31T09:00:00+00:00",and(created_at.eq."2026-10-31T09:00:00+00:00",id.lt."m1")'
    );
  });

  it('offsets the next page past every row loaded so far', () => {
    expect(
      nextOffset(
        [
          [1, 2],
          [3, 4],
        ],
        2
      )
    ).toBe(4);
    expect(nextOffset([[1, 2], [3]], 2)).toBeUndefined();
    expect(nextOffset([], 2)).toBeUndefined();
  });

  it('drops a row an offset page saw twice', () => {
    expect(
      uniqueById([
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'c' }],
      ]).map((row) => row.id)
    ).toEqual(['a', 'b', 'c']);
  });
});
