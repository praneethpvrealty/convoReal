import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261027110000_copilot_property_interest_thread.sql'
  ),
  'utf8'
);

describe('copilot property interest thread', () => {
  it('[CPL-004] the Helper reads each contact’s WhatsApp thread from a new function, with nothing held', () => {
    expect(migration).not.toMatch(/\bDROP\b/);
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.copilot_property_interest_v3('
    );
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.copilot_property_interest_v2('
    );
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.copilot_property_interest('
    );
    expect(migration).toMatch(
      /last_at TIMESTAMPTZ,\s+conversation_id UUID,\s+total BIGINT/
    );
    expect(migration).toMatch(
      /LEFT JOIN conversations cv\s+ON cv\.account_id = p_account_id\s+AND cv\.contact_id = c\.id/
    );
    expect(migration).toContain('cv.id AS conversation_id');
    expect(migration).toContain('WHERE public.is_account_member(p_account_id)');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.copilot_property_interest_v3(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.copilot_property_interest_v3(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) TO authenticated;'
    );
  });
});
