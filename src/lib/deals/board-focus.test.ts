import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { boardDeals } from './board-focus';

const deals = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261001113322_board_focus_deal_ids.sql'
  ),
  'utf8'
);

describe('[TXW-026] the Board shows Focus journeys by default', () => {
  it('keeps only the deals the database counts as Focus', () => {
    expect(boardDeals(deals, 'focus', ['a', 'c']).map((d) => d.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('shows every deal under All', () => {
    expect(boardDeals(deals, 'all', null)).toHaveLength(3);
    expect(boardDeals(deals, 'all', ['a'])).toHaveLength(3);
  });

  it('never falls back to All while Focus is loading or failed', () => {
    expect(boardDeals(deals, 'focus', null)).toEqual([]);
    expect(boardDeals(deals, 'focus', undefined)).toEqual([]);
  });

  it('counts a buyer or listing journey in Focus only while it is active', () => {
    expect(migration).toContain(
      "AND (s.lifecycle_status <> 'active' OR s.archived_at IS NOT NULL)"
    );
    expect(migration).toMatch(
      /\(f\.mode = 'buyer' AND f\.subject_id = d\.contact_id\)\s+OR \(f\.mode = 'property' AND f\.subject_id = d\.property_id\)/
    );
  });

  it('follows the team or per-agent Focus scope and the caller’s membership', () => {
    expect(migration).toContain(
      "CASE WHEN a.journey_compartment_scope = 'agent' THEN auth.uid() END"
    );
    expect(migration).toContain(
      'JOIN owner o ON jc.user_id IS NOT DISTINCT FROM o.user_id'
    );
    expect(migration).toContain('AND is_account_member(target_account_id)');
  });
});
