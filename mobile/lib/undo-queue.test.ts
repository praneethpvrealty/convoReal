import { describe, expect, it } from 'vitest';

import {
  liveUndoEntries,
  pushUndoEntry,
  removeUndoEntry,
  undoBarLabel,
  visibleUndoEntry,
} from '@/lib/undo-queue';

const entry = (key: number, expiresAt: number) => ({ key, expiresAt });

describe('[CAL-009] every undo stays available for its full window', () => {
  it('stacks a newer action on top without dropping the earlier one', () => {
    const entries = pushUndoEntry(
      pushUndoEntry([], entry(1, 100)),
      entry(2, 200)
    );
    expect(entries.map((e) => e.key)).toEqual([1, 2]);
    expect(visibleUndoEntry(entries)?.key).toBe(2);
  });

  it('shows the previous action again once the newest is undone', () => {
    const entries = [entry(1, 100), entry(2, 200)];
    const after = removeUndoEntry(entries, 2);
    expect(visibleUndoEntry(after)?.key).toBe(1);
    expect(visibleUndoEntry(removeUndoEntry(after, 1))).toBeNull();
  });

  it('expires each entry on its own clock', () => {
    const entries = [entry(1, 100), entry(2, 200), entry(3, 300)];
    expect(liveUndoEntries(entries, 150).map((e) => e.key)).toEqual([2, 3]);
    expect(liveUndoEntries(entries, 300)).toEqual([]);
  });

  it('tells the user when more undos are waiting', () => {
    expect(undoBarLabel('Deleted "Call Ravi"', 1)).toBe('Deleted "Call Ravi"');
    expect(undoBarLabel('Deleted "Call Ravi"', 3)).toBe(
      'Deleted "Call Ravi" · 2 more'
    );
  });
});
