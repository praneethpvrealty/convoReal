import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261025165201_consolidate_legacy_merged_conversations.sql'
  ),
  'utf8'
);

describe('[CTM-001] contacts merged before conversations were consolidated', () => {
  it('folds a merged-away thread into the surviving contact through the merge function', () => {
    expect(sql).toContain(
      'PERFORM merge_contact_conversations(r.account_id, r.alias_id, r.winner_id);'
    );
    expect(sql).toContain('AND NOT w.is_merged');
  });

  it('follows a merge chain to the contact that survived it', () => {
    expect(sql).toContain('WITH RECURSIVE chain AS');
    expect(sql).toContain('ch.depth < 5');
  });

  it('only folds threads of records on the same WhatsApp number', () => {
    expect(sql).toContain(
      "right(regexp_replace(ch.alias_phone, '\\D', '', 'g'), 10)"
    );
    expect(sql).toContain(
      "= right(regexp_replace(coalesce(w.phone, ''), '\\D', '', 'g'), 10)"
    );
  });
});
