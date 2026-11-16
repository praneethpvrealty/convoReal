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

describe('contacts_matching_phone_key', () => {
  it('[CTM-018] matches the last ten digits of the stored phone within one account', () => {
    expect(sql).toContain('c.account_id = p_account_id');
    expect(sql).toContain(
      "right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = p_key"
    );
    expect(sql).toContain(
      "ON public.contacts (account_id, right(regexp_replace(phone, '\\D', '', 'g'), 10))"
    );
  });

  it('[CTM-018] guards on agent membership and keeps the function from anon', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain("is_account_member(p_account_id, 'agent')");
    const signature = 'public.contacts_matching_phone_key(UUID, TEXT)';
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`);
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`
    );
    expect(sql).not.toMatch(/\bDROP\b/);
  });
});
