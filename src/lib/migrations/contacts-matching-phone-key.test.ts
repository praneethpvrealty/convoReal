import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261116045705_contacts_matching_phone_key.sql'
  ),
  'utf8'
);

function body(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  return sql.slice(start, sql.indexOf('$$;', start));
}

describe('phone-key duplicate lookups', () => {
  it('[CTM-018] match the last ten digits of unmerged contacts in one account', () => {
    for (const name of [
      'visible_contact_with_phone_key',
      'account_has_phone_key',
    ]) {
      const fn = body(name);
      expect(fn).toContain('c.account_id = p_account_id');
      expect(fn).toContain('NOT c.is_merged');
      expect(fn).toContain(
        "right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = p_key"
      );
      expect(fn).toContain('SET search_path = public');
      const signature = `public.${name}(UUID, TEXT)`;
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`);
      expect(sql).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`
      );
    }
    expect(sql).toContain(
      "ON public.contacts (account_id, right(regexp_replace(phone, '\\D', '', 'g'), 10))"
    );
  });

  it('[CTM-018] returns contact details only under the caller’s RLS', () => {
    const visible = body('visible_contact_with_phone_key');
    expect(visible).toContain('SECURITY INVOKER');
    expect(visible).not.toContain('SECURITY DEFINER');
  });

  it('[CTM-018] answers only yes or no about contacts the caller cannot read', () => {
    const taken = body('account_has_phone_key');
    expect(taken).toContain('SECURITY DEFINER');
    expect(taken).toContain('RETURNS BOOLEAN');
    expect(taken).toContain("is_account_member(p_account_id, 'agent')");
    expect(taken).not.toMatch(/SELECT\s+c\./);
  });

  it('[CTM-018] closes the earlier row-returning lookup without dropping anything', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.contacts_matching_phone_key(UUID, TEXT) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).not.toMatch(/\bDROP\b/);
  });
});
