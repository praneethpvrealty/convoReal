import { describe, expect, it } from 'vitest';

import {
  TRANCHE_STATUS_LABELS,
  trancheReceived,
  trancheStatus,
} from './deal-workspace';

const base = {
  amount: 50_00_000,
  due_date: '2026-10-01' as string | null,
  received_at: null as string | null,
  received_amount: null as number | null,
};

describe('[TXW-021] the tranche label mirrors the web rule', () => {
  it('reads a receipt date as the full amount unless a part is recorded', () => {
    expect(trancheReceived(base)).toBe(0);
    expect(trancheReceived({ ...base, received_at: '2026-10-01' })).toBe(
      50_00_000
    );
    expect(
      trancheReceived({
        ...base,
        received_at: '2026-10-01',
        received_amount: 10,
      })
    ).toBe(10);
  });

  it('labels received, part, overdue, due and scheduled', () => {
    const today = '2026-10-01';
    expect(trancheStatus({ ...base, received_at: '2026-09-30' }, today)).toBe(
      'received'
    );
    expect(trancheStatus({ ...base, received_amount: 10 }, today)).toBe(
      'partial'
    );
    expect(trancheStatus({ ...base, due_date: '2026-09-30' }, today)).toBe(
      'overdue'
    );
    expect(trancheStatus(base, today)).toBe('due');
    expect(trancheStatus({ ...base, due_date: null }, today)).toBe('scheduled');
    expect(Object.keys(TRANCHE_STATUS_LABELS)).toHaveLength(5);
  });
});
