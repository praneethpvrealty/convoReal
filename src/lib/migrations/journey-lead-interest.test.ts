import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const columns = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261024163000_journey_lead_interest.sql'
  ),
  'utf8'
);

const signals = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261024163100_journey_lead_interest_signals.sql'
  ),
  'utf8'
);

describe('journey lead interest columns', () => {
  it('[JRN-026] adds the nullable stamp and its index without touching anything live', () => {
    expect(columns).toContain(
      "ADD COLUMN IF NOT EXISTS lead_interest TEXT\n    CHECK (lead_interest IN ('interested', 'shortlisted'))"
    );
    expect(columns).toContain(
      'ADD COLUMN IF NOT EXISTS lead_interest_at TIMESTAMPTZ'
    );
    expect(columns).toContain(
      'CREATE INDEX IF NOT EXISTS idx_journey_items_lead_interest'
    );
    expect(columns).toContain('WHERE lead_interest IS NOT NULL');
    expect(columns).not.toMatch(/\bDROP\b/);
    expect(columns).not.toMatch(/\bUPDATE\b/);
    expect(columns).not.toContain('CREATE OR REPLACE');
  });
});

describe('journey lead interest signals', () => {
  it('[JRN-026] backfills Interested answers and WhatsApp Shortlist taps, capturing missing pairs hidden', () => {
    expect(signals).toContain("WHERE f.verdict = 'interested'");
    expect(signals).toContain("AND l.session_key LIKE 'wa:%'");
    expect(signals).toMatch(
      /AND l\.session_key LIKE 'wa:%'\s+AND NOT EXISTS \(\s+SELECT 1 FROM listing_feedback f\s+WHERE f\.contact_id = l\.contact_id\s+AND f\.property_id = l\.property_id\s+AND f\.verdict = 'rejected'\s+\)/
    );
    expect(signals).toContain(
      "CASE s.kind WHEN 'interested' THEN 0 ELSE 1 END, s.at DESC"
    );
    expect(signals).toContain(
      "r.account_id, r.contact_id, r.property_id, fs.id, 'whatsapp_share', TRUE,"
    );
    expect(signals).toContain(
      'ON CONFLICT (account_id, contact_id, property_id) DO NOTHING'
    );
    expect(signals).toContain(
      "SELECT account_id, id, 'added', stage_id, 'Captured from lead interest', created_at"
    );
    expect(signals).toContain(
      "OR (ji.lead_interest = 'shortlisted' AND r.kind = 'interested')"
    );
    expect(signals).not.toContain('SET hidden');
  });

  it('[CPL-004] [JRN-026] the Helper reads the lead’s own Interested answers as a signal', () => {
    expect(signals).toContain(
      'DROP FUNCTION IF EXISTS public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT);'
    );
    expect(signals).toMatch(
      /liked BOOLEAN,\s+interested BOOLEAN,\s+journey_stage TEXT,/
    );
    expect(signals).toContain(
      "SELECT f.property_id, f.contact_id, 'interested', NULL, NULL, COALESCE(f.updated_at, f.created_at)"
    );
    expect(signals).toContain('FROM listing_feedback f');
    expect(signals).toContain("BOOL_OR(s.kind = 'interested') AS interested");
    expect(signals).toContain(
      "OR (sc.signal = 'interested' AND pr.interested)"
    );
    expect(signals).toContain('WHERE public.is_account_member(p_account_id)');
    expect(signals).toContain(
      'REVOKE ALL ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon;'
    );
    expect(signals).toContain(
      'GRANT EXECUTE ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) TO authenticated;'
    );
  });

  it('[JRN-026] the overview counts the yeses per journey for both surfaces', () => {
    expect(signals).toContain(
      'CREATE OR REPLACE FUNCTION public.journey_overview_groups('
    );
    expect(signals).toContain(
      'count(*) FILTER (WHERE items.lead_interest IS NOT NULL) AS interested_count,'
    );
    expect(signals).toContain("'interested_count', grouped.interested_count,");
    expect(signals).toContain("'captured_count', grouped.captured_count,");
    expect(signals).toContain('OR NOT is_account_member(p_account_id) THEN');
  });
});
