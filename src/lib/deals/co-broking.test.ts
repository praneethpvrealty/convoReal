import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEAL_POSITIONS,
  DEAL_POSITION_LABELS,
  netOfPayouts,
  parseDealPosition,
  parsePayoutInput,
  parsePayoutPatch,
  patchClearsPayment,
  payoutFromPercent,
  payoutPaid,
  payoutStatus,
  sortPayouts,
  summarizeCoBroking,
} from './co-broking';
import { INTERNAL_ONLY_DEAL_FIELDS } from './financials';

describe('[TXW-023] co-broking payouts', () => {
  it('requires a broker and an amount on a new payout', () => {
    expect(parsePayoutInput({ amount: 100 })).toEqual({
      ok: false,
      error: 'Name the broker you pay',
    });
    expect(parsePayoutInput({ payee_name: 'Ravi Realty' })).toEqual({
      ok: false,
      error: 'Give the payout an amount',
    });
    expect(
      parsePayoutInput({
        payee_name: '  Ravi Realty ',
        amount: '450000.456',
        side: 'buyer',
        share_percent: '0.5',
      })
    ).toEqual({
      ok: true,
      value: {
        payee_name: 'Ravi Realty',
        stakeholder_id: null,
        side: 'buyer',
        share_percent: 0.5,
        amount: 450000.46,
        paid_at: null,
        paid_amount: null,
        instrument_ref: null,
        notes: null,
      },
    });
  });

  it('rejects bad sides, percentages, dates and stakeholder ids', () => {
    expect(parsePayoutPatch({ side: 'both' })).toMatchObject({ ok: false });
    expect(parsePayoutPatch({ share_percent: 120 })).toMatchObject({
      ok: false,
    });
    expect(parsePayoutPatch({ paid_at: 'today' })).toMatchObject({ ok: false });
    expect(parsePayoutPatch({ stakeholder_id: 'x' })).toMatchObject({
      ok: false,
    });
    expect(parsePayoutPatch({ amount: -1 })).toMatchObject({ ok: false });
    expect(parsePayoutPatch({})).toEqual({
      ok: false,
      error: 'Nothing to update',
    });
  });

  it('returns only the fields a patch names', () => {
    expect(
      parsePayoutPatch({ paid_at: '2026-10-01', instrument_ref: ' UTR9 ' })
    ).toEqual({
      ok: true,
      value: { paid_at: '2026-10-01', instrument_ref: 'UTR9' },
    });
  });

  it('never turns a paid payout back into an unpaid one', () => {
    const paid = { paid_at: '2026-10-01', paid_amount: null };
    expect(patchClearsPayment(paid, { paid_at: null })).toBe(true);
    expect(
      patchClearsPayment(
        { paid_at: null, paid_amount: 100 },
        { paid_amount: null }
      )
    ).toBe(true);
    expect(patchClearsPayment(paid, { paid_at: '2026-10-02' })).toBe(false);
    expect(patchClearsPayment(paid, { paid_at: null, paid_amount: 50 })).toBe(
      false
    );
    expect(
      patchClearsPayment(
        { paid_at: null, paid_amount: null },
        { paid_at: null }
      )
    ).toBe(false);
  });

  it('guards the payout invariants in the database too', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260928042711_deal_co_broking.sql'
      ),
      'utf8'
    );
    expect(sql).toContain('A paid payout cannot be marked unpaid');
    expect(sql).toContain('pg_advisory_xact_lock(');
    expect(sql).toContain(
      'SET co_broker_payout_total = co_broker_payout_total + NEW.amount'
    );
    expect(sql).toContain(
      'SET co_broker_payout_total = co_broker_payout_total - OLD.amount'
    );
    expect(sql).not.toContain('SELECT SUM(p.amount)');
    expect(sql).toContain('A payout stays on its deal');
    expect(sql).toContain('AND p.is_read_only IS NOT TRUE');
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OF co_broker_payout_total ON deals'
    );
    expect(sql).toContain('NEW.updated_at := OLD.updated_at;');
    expect(sql).toContain("AND s.role = 'broker'");
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OF stakeholder_id, deal_id, account_id, paid_at, paid_amount'
    );
  });

  it('turns a share of the deal value into rupees', () => {
    expect(payoutFromPercent(90_000_000, '0.5')).toBe(450_000);
    expect(payoutFromPercent(null, 1)).toBe(0);
    expect(payoutFromPercent(90_000_000, '')).toBe(0);
  });

  it('decides paid, part paid and to pay', () => {
    const base = { amount: 300_000, paid_at: null, paid_amount: null };
    expect(payoutStatus(base)).toBe('owed');
    expect(payoutStatus({ ...base, paid_at: '2026-10-01' })).toBe('paid');
    expect(
      payoutStatus({ ...base, paid_at: '2026-10-01', paid_amount: 100_000 })
    ).toBe('partial');
    expect(payoutPaid({ ...base, paid_amount: 900_000 })).toBe(300_000);
  });

  it('nets the payouts out of what the brokerage collects', () => {
    const summary = summarizeCoBroking(1_800_000, [
      { amount: 450_000, paid_at: '2026-10-01', paid_amount: null },
      { amount: 450_000, paid_at: null, paid_amount: null },
    ]);
    expect(summary).toEqual({
      collected: 1_800_000,
      payouts: 900_000,
      paid_out: 450_000,
      to_pay: 450_000,
      net: 900_000,
    });
    expect(summarizeCoBroking(null, []).net).toBeNull();
    expect(netOfPayouts(100, 250)).toBe(0);
    expect(netOfPayouts(-500, 0)).toBe(-500);
    expect(netOfPayouts(600_000, null)).toBe(600_000);
  });

  it('keeps the agent order', () => {
    const rows = sortPayouts([
      { position: 1, created_at: '2026-09-01' },
      { position: 0, created_at: '2026-09-02' },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it('knows every position and nothing else', () => {
    for (const p of DEAL_POSITIONS) {
      expect(DEAL_POSITION_LABELS[p]).toBeTruthy();
      expect(parseDealPosition(p)).toEqual({ ok: true, value: p });
    }
    expect(parseDealPosition(null)).toEqual({ ok: true, value: null });
    expect(parseDealPosition('broker')).toMatchObject({ ok: false });
  });

  it('keeps the position and payout total internal only', () => {
    expect(INTERNAL_ONLY_DEAL_FIELDS).toContain('deal_position');
    expect(INTERNAL_ONLY_DEAL_FIELDS).toContain('co_broker_payout_total');
  });
});
