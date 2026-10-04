import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20261004071750_broadcast_audience_rpc.sql'
);

const AUDIENCE_SIGNATURE =
  '(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN)';

function body(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end);
}

describe('broadcast audience RPCs', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('guards every function on agent membership and keeps it from anon', () => {
    for (const [name, signature] of [
      ['broadcast_audience_contact_ids', AUDIENCE_SIGNATURE],
      ['count_broadcast_audience', AUDIENCE_SIGNATURE],
      ['contacts_matching_phone_digits', '(UUID, TEXT[])'],
    ]) {
      const fn = body(sql, name);
      expect(fn).toContain('SECURITY DEFINER');
      expect(fn).toContain('SET search_path = public');
      expect(fn).toContain("is_account_member(p_account_id, 'agent')");
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.${name}${signature} FROM PUBLIC;`
      );
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.${name}${signature} FROM anon;`
      );
      expect(sql).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}${signature} TO authenticated;`
      );
    }
  });

  it('defines the recipient rules once and counts through them', () => {
    const fn = body(sql, 'broadcast_audience_contact_ids');
    expect(fn).toContain('c.account_id = p_account_id');
    expect(fn).toContain("c.phone ~ '\\S'");
    expect(fn).toContain("c.buyer_alerts_consent <> 'declined'");
    expect(fn).toContain('NOT c.chain_only');
    expect(fn).toContain('NOT c.is_dead');
    expect(fn).toContain('NOT c.is_archived');
    expect(fn).toContain(
      "(NOT COALESCE(p_opted_in_only, FALSE) OR c.buyer_alerts_consent = 'granted')"
    );
    expect(fn).toMatch(/AND NOT EXISTS \([\s\S]*p_exclude_tag_ids/);
    expect(body(sql, 'count_broadcast_audience')).toMatch(
      /SELECT count\(\*\)\s+FROM broadcast_audience_contact_ids\(/
    );
  });

  it('matches CSV numbers on the indexed digits-only phone, opted-out contacts included', () => {
    const fn = body(sql, 'contacts_matching_phone_digits');
    expect(fn).toContain(
      "regexp_replace(c.phone, '\\D', '', 'g') = ANY (p_digits)"
    );
    expect(fn).not.toMatch(/consent|is_dead|is_archived|chain_only/);
  });
});
