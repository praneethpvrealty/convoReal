import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260928082811_journey_overview_enquiry_sources.sql'
  ),
  'utf8'
);

describe('journey overview enquiry sources', () => {
  it('[JRN-012] returns the latest enquiry source and how many sources there are', () => {
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS public.journey_overview_enquiries(UUID, TEXT);'
    );
    expect(migration).toMatch(
      /last_enquired_at TIMESTAMPTZ,\s+last_enquiry_source TEXT,\s+enquiry_source_count BIGINT/
    );
    expect(migration).toContain(
      "NULLIF(btrim(inquiries.inquiry_source), '') AS source"
    );
    expect(migration).toMatch(
      /\(array_agg\(enquiries\.source ORDER BY enquiries\.enquired_at DESC[^)]*\)\s+FILTER \(WHERE enquiries\.source IS NOT NULL\)\)\[1\]/
    );
    expect(migration).toContain('count(DISTINCT enquiries.source)');
  });

  it('[JRN-012] keeps the account guard and grants of the function it replaces', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('OR NOT is_account_member(p_account_id) THEN');
    expect(migration).toContain('WHERE inquiries.account_id = p_account_id');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.journey_overview_enquiries(UUID, TEXT) FROM PUBLIC, anon;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.journey_overview_enquiries(UUID, TEXT) TO authenticated;'
    );
  });
});
