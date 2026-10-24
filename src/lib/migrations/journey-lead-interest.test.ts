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

const copilot = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261024163200_copilot_property_interest_said_interested.sql'
  ),
  'utf8'
);

const leadOnly = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261024163300_journey_lead_interest_only_hidden.sql'
  ),
  'utf8'
);

describe('journey lead interest only hidden', () => {
  it('[JRN-026] the earlier lead-only lookup stays applied but callable by nobody', () => {
    expect(leadOnly).toContain(
      'CREATE OR REPLACE FUNCTION public.journey_lead_interest_only_hidden('
    );
    expect(leadOnly).toContain('SECURITY DEFINER');
    expect(leadOnly).toContain('WHERE public.is_account_member(p_account_id)');
    expect(leadOnly).toContain('AND ji.account_id = p_account_id');
    expect(leadOnly).toContain('AND ji.hidden');
    expect(leadOnly).toContain(
      '(p_contact_ids IS NULL OR ji.contact_id = ANY (p_contact_ids))'
    );
    expect(leadOnly).toContain(
      '(p_property_ids IS NULL OR ji.property_id = ANY (p_property_ids))'
    );
    expect(leadOnly).toContain("AND e.reason = 'Captured from lead interest'");
    expect(leadOnly).toContain("AND e.event_type IN ('hidden', 'unhidden')");
    expect(leadOnly).not.toMatch(/\bDROP\b/);
    expect(leadOnly).toContain(
      'REVOKE ALL ON FUNCTION public.journey_lead_interest_only_hidden(UUID, UUID[], UUID[]) FROM PUBLIC, anon, authenticated;'
    );
    expect(leadOnly).not.toContain('GRANT EXECUTE');
  });
});

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
  it('[JRN-026] a stamp-only update never counts as activity on the item, live or backfilled', () => {
    expect(signals).toContain(
      'CREATE OR REPLACE FUNCTION public.journey_items_set_updated_at()'
    );
    expect(signals).toMatch(
      /v_old\.lead_interest := NULL;\s+v_old\.lead_interest_at := NULL;\s+v_new\.lead_interest := NULL;\s+v_new\.lead_interest_at := NULL;\s+IF v_new IS NOT DISTINCT FROM v_old\s+AND \(NEW\.lead_interest, NEW\.lead_interest_at\)\s+IS DISTINCT FROM \(OLD\.lead_interest, OLD\.lead_interest_at\) THEN\s+NEW\.updated_at := OLD\.updated_at;\s+ELSE\s+NEW\.updated_at := NOW\(\);/
    );
    expect(signals).not.toContain('v_old.updated_at := NULL');
    expect(signals).toContain(
      'CREATE OR REPLACE TRIGGER set_journey_items_updated_at\n  BEFORE UPDATE ON journey_items\n  FOR EACH ROW EXECUTE FUNCTION public.journey_items_set_updated_at();'
    );
  });

  it('[JRN-026] reads the strongest yes on file: Interested over a Shortlist tap the lead did not take back', () => {
    expect(signals).toContain(
      'CREATE OR REPLACE FUNCTION public.journey_lead_interest_on_file('
    );
    expect(signals).toContain("AND f.verdict = 'interested'");
    expect(signals).toContain("AND l.session_key LIKE 'wa:%'");
    expect(signals).toMatch(
      /AND l\.session_key LIKE 'wa:%'\s+AND NOT EXISTS \(\s+SELECT 1 FROM listing_feedback f\s+WHERE f\.contact_id = l\.contact_id\s+AND f\.property_id = l\.property_id\s+AND f\.verdict = 'rejected'\s+AND f\.source = 'contact'\s+AND COALESCE\(f\.updated_at, f\.created_at\) > l\.created_at\s+\)/
    );
    expect(signals).toContain(
      "ORDER BY CASE s.kind WHEN 'interested' THEN 0 ELSE 1 END, s.at DESC"
    );
    expect(signals).toContain(
      'REVOKE ALL ON FUNCTION public.journey_lead_interest_on_file(UUID, UUID) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('[JRN-009] [JRN-026] a yes never creates a pair: the capture seeds the stamp and the backfill stamps existing rows only', () => {
    expect(signals).toContain(
      'CREATE OR REPLACE TRIGGER seed_journey_items_lead_interest\n  BEFORE INSERT ON journey_items\n  FOR EACH ROW EXECUTE FUNCTION public.journey_items_seed_lead_interest();'
    );
    expect(signals).toMatch(
      /IF NEW\.lead_interest IS NULL THEN\s+SELECT y\.lead_interest, y\.lead_interest_at\s+INTO NEW\.lead_interest, NEW\.lead_interest_at\s+FROM journey_lead_interest_on_file\(NEW\.contact_id, NEW\.property_id\) y;/
    );
    expect(signals).toMatch(
      /UPDATE journey_items ji\s+SET lead_interest = y\.lead_interest,\s+lead_interest_at = y\.lead_interest_at\s+FROM journey_items j2\s+CROSS JOIN LATERAL journey_lead_interest_on_file\(j2\.contact_id, j2\.property_id\) y/
    );
    expect(signals).toContain(
      "OR (ji.lead_interest = 'shortlisted' AND y.lead_interest = 'interested')"
    );
    expect(signals).not.toContain('INSERT INTO journey_items');
    expect(signals).not.toContain('SET hidden');
    expect(signals).not.toContain('journey_capture_from_share');
    expect(signals).not.toMatch(/\bDROP\b/);
  });

  it('[CPL-004] [JRN-026] the Helper reads the lead’s own Interested answers as a signal from a new function, with nothing held', () => {
    expect(signals).not.toMatch(/\bDROP\b/);
    expect(signals).not.toContain(
      'CREATE OR REPLACE FUNCTION public.copilot_property_interest('
    );
    expect(copilot).not.toMatch(/\bDROP\b/);
    expect(copilot).toContain(
      'CREATE OR REPLACE FUNCTION public.copilot_property_interest_v2('
    );
    expect(copilot).not.toContain(
      'CREATE OR REPLACE FUNCTION public.copilot_property_interest('
    );
    expect(copilot).toMatch(
      /liked BOOLEAN,\s+interested BOOLEAN,\s+journey_stage TEXT,/
    );
    expect(copilot).toContain(
      "SELECT f.property_id, f.contact_id, 'interested', NULL, NULL, COALESCE(f.updated_at, f.created_at)"
    );
    expect(copilot).toContain('FROM listing_feedback f');
    expect(copilot).toContain("BOOL_OR(s.kind = 'interested') AS interested");
    expect(copilot).toContain(
      "OR (sc.signal = 'interested' AND pr.interested)"
    );
    expect(copilot).toContain('WHERE public.is_account_member(p_account_id)');
    expect(copilot).toContain(
      'REVOKE ALL ON FUNCTION public.copilot_property_interest_v2(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon;'
    );
    expect(copilot).toContain(
      'GRANT EXECUTE ON FUNCTION public.copilot_property_interest_v2(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) TO authenticated;'
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
