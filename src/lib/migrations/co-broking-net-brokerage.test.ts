import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260928042711_deal_co_broking.sql'),
  'utf8'
);

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260928042712_co_broking_net_brokerage.sql'
  ),
  'utf8'
);

describe('[TXW-024] dashboard functions count the brokerage share', () => {
  it('replaces every function that sums brokerage', () => {
    for (const fn of [
      'dashboard_metrics',
      'dashboard_pipeline_donut',
      'team_analytics',
      'lead_source_analytics',
    ]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    }
  });

  it('subtracts co-broker payouts, floored at zero, in each of them', () => {
    const net =
      'GREATEST(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02) - COALESCE(d.co_broker_payout_total, 0), 0)';
    expect(sql.split(net).length - 1).toBe(4);
    expect(sql).not.toMatch(/SUM\(COALESCE\(d\.brokerage_amount/);
  });

  it('keeps every guard of the live bodies', () => {
    expect(sql.match(/is_account_member\(p_account_id\)/g)?.length).toBe(4);
    expect(sql.match(/SECURITY DEFINER/g)?.length).toBe(4);
  });

  it('trusts a payout total no client can write or skew', () => {
    expect(schema).toContain(
      'BEFORE INSERT OR UPDATE OF co_broker_payout_total ON deals'
    );
    expect(schema).toContain('IF pg_trigger_depth() <= 1 THEN');
    expect(schema).toContain(
      'A payout stays on its deal. Remove it and add it to the other deal instead'
    );
  });
});
