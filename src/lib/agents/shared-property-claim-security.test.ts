import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260909092148_agent_shared_property_claims.sql',
  'utf8'
);

describe('shared property onboarding claim boundary', () => {
  it('keeps the phone lookup service-role-only', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.find_property_shares_for_phone\(TEXT\) FROM PUBLIC;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.find_property_shares_for_phone\(TEXT\) FROM anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.find_property_shares_for_phone\(TEXT\) TO service_role;/
    );
  });

  it('only returns published listings shared to the matching contact phone', () => {
    expect(migration).toContain('JOIN contacts c');
    expect(migration).toContain('JOIN properties p');
    expect(migration).toContain("regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g')");
    expect(migration).toContain('AND p.is_published = TRUE');
  });
});
