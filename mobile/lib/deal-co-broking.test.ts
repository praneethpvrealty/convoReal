import { describe, expect, it } from 'vitest';

import {
  DEAL_POSITION_LABELS,
  PAYOUT_STATUS_LABELS,
  netOfPayouts,
  payoutFromPercent,
  payoutPaid,
  payoutStatus,
} from './deal-workspace';

const base = {
  amount: 4_50_000,
  paid_at: null as string | null,
  paid_amount: null as number | null,
};

describe('[TXW-023] co-broking mirrors the web rule', () => {
  it('reads a paid date as the full amount unless a part is recorded', () => {
    expect(payoutPaid(base)).toBe(0);
    expect(payoutPaid({ ...base, paid_at: '2026-10-01' })).toBe(4_50_000);
    expect(payoutPaid({ ...base, paid_amount: 9_00_000 })).toBe(4_50_000);
  });

  it('labels a payout paid, part paid or to pay', () => {
    expect(PAYOUT_STATUS_LABELS[payoutStatus(base)]).toBe('To pay');
    expect(payoutStatus({ ...base, paid_at: '2026-10-01' })).toBe('paid');
    expect(
      payoutStatus({ ...base, paid_at: '2026-10-01', paid_amount: 1 })
    ).toBe('partial');
  });

  it('prefills a share of the deal and nets payouts out, never below zero', () => {
    expect(payoutFromPercent(9_00_00_000, '0.5')).toBe(4_50_000);
    expect(payoutFromPercent(null, '1')).toBe(0);
    expect(netOfPayouts(18_00_000, 9_00_000)).toBe(9_00_000);
    expect(netOfPayouts(100, 250)).toBe(0);
    expect(netOfPayouts(6_00_000, undefined)).toBe(6_00_000);
  });

  it('names every position', () => {
    expect(Object.keys(DEAL_POSITION_LABELS)).toEqual([
      'direct',
      'buyer_side',
      'seller_side',
      'intermediary',
    ]);
  });
});
