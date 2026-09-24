import { describe, expect, it } from 'vitest';

import {
  parseTrancheInput,
  parseTranchePatch,
  sortTranches,
  summarizeTranches,
  trancheReceived,
  trancheStatus,
  TRANCHE_LABEL_MAX,
  type DealPaymentTranche,
} from './tranches';

function tranche(over: Partial<DealPaymentTranche> = {}): DealPaymentTranche {
  return {
    id: 't',
    account_id: 'a',
    deal_id: 'd',
    position: 0,
    label: 'Token',
    amount: 50_00_000,
    due_date: '2026-10-01',
    received_at: null,
    received_amount: null,
    instrument_ref: null,
    notes: null,
    created_by: null,
    created_at: '2026-09-24T00:00:00.000Z',
    updated_at: '2026-09-24T00:00:00.000Z',
    ...over,
  };
}

describe('[TXW-021] payment tranches', () => {
  it('requires a label and an amount on a new tranche', () => {
    expect(parseTrancheInput({ amount: 100 })).toEqual({
      ok: false,
      error: 'Give the tranche a label',
    });
    expect(parseTrancheInput({ label: 'Token' })).toEqual({
      ok: false,
      error: 'Give the tranche an amount',
    });
    const r = parseTrancheInput({ label: ' Token ', amount: '5000000' });
    expect(r).toEqual({
      ok: true,
      value: {
        label: 'Token',
        amount: 5_000_000,
        due_date: null,
        received_at: null,
        received_amount: null,
        instrument_ref: null,
        notes: null,
      },
    });
  });

  it('refuses negative money, bad dates and over-long text', () => {
    expect(parseTranchePatch({ amount: -1 })).toMatchObject({ ok: false });
    expect(parseTranchePatch({ due_date: '1 Oct' })).toMatchObject({
      ok: false,
      error: 'Due date must be YYYY-MM-DD',
    });
    expect(
      parseTranchePatch({ label: 'x'.repeat(TRANCHE_LABEL_MAX + 1) })
    ).toMatchObject({ ok: false });
    expect(parseTranchePatch({})).toEqual({
      ok: false,
      error: 'Nothing to update',
    });
    expect(parseTranchePatch({ position: 1.5 })).toMatchObject({ ok: false });
  });

  it('returns only the keys named, clearing with null', () => {
    expect(parseTranchePatch({ received_at: '2026-10-02', notes: '' })).toEqual(
      {
        ok: true,
        value: { received_at: '2026-10-02', notes: null },
      }
    );
  });

  it('counts a receipt date as the full amount unless a part amount is recorded', () => {
    expect(trancheReceived(tranche())).toBe(0);
    expect(trancheReceived(tranche({ received_at: '2026-10-01' }))).toBe(
      50_00_000
    );
    expect(
      trancheReceived(
        tranche({ received_at: '2026-10-01', received_amount: 20_00_000 })
      )
    ).toBe(20_00_000);
    expect(trancheReceived(tranche({ received_amount: 99_00_000 }))).toBe(
      50_00_000
    );
  });

  it('labels a tranche by what has come in and when it was due', () => {
    const today = '2026-10-01';
    expect(trancheStatus(tranche({ received_at: '2026-09-30' }), today)).toBe(
      'received'
    );
    expect(trancheStatus(tranche({ received_amount: 10 }), today)).toBe(
      'partial'
    );
    expect(trancheStatus(tranche({ due_date: '2026-09-30' }), today)).toBe(
      'overdue'
    );
    expect(trancheStatus(tranche({ due_date: '2026-10-01' }), today)).toBe(
      'due'
    );
    expect(trancheStatus(tranche({ due_date: '2026-10-05' }), today)).toBe(
      'scheduled'
    );
    expect(trancheStatus(tranche({ due_date: null }), today)).toBe('scheduled');
  });

  it('sums scheduled, received and outstanding on the server', () => {
    expect(
      summarizeTranches([
        tranche({ amount: 5_00_00_000, received_at: '2026-09-20' }),
        tranche({ amount: 3_00_00_000, received_amount: 1_00_00_000 }),
        tranche({ amount: 3_50_00_000 }),
      ])
    ).toEqual({
      count: 3,
      scheduled: 11_50_00_000,
      received: 6_00_00_000,
      outstanding: 5_50_00_000,
    });
  });

  it('orders by due date, undated last, then the agent’s order', () => {
    const sorted = sortTranches([
      tranche({ id: 'undated', due_date: null, position: 0 }),
      tranche({ id: 'later', due_date: '2026-11-01', position: 1 }),
      tranche({ id: 'soon', due_date: '2026-10-01', position: 2 }),
      tranche({ id: 'undated2', due_date: null, position: 1 }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual([
      'soon',
      'later',
      'undated',
      'undated2',
    ]);
  });
});
