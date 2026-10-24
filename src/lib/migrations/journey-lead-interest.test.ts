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
  it('[JRN-026] reads the unreviewed lead-interest captures in SQL, guarded by membership', () => {
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
      'REVOKE ALL ON FUNCTION public.journey_lead_interest_only_hidden(UUID, UUID[], UUID[]) FROM PUBLIC, anon;'
    );
    expect(leadOnly).toContain(
      'GRANT EXECUTE ON FUNCTION public.journey_lead_interest_only_hidden(UUID, UUID[], UUID[]) TO authenticated;'
    );
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
  it('[JRN-026] backfills Interested answers and WhatsApp Shortlist taps, capturing missing pairs hidden', () => {
    expect(signals).toContain("WHERE f.verdict = 'interested'");
    expect(signals).toContain("AND l.session_key LIKE 'wa:%'");
    expect(signals).toMatch(
      /AND l\.session_key LIKE 'wa:%'\s+AND NOT EXISTS \(\s+SELECT 1 FROM listing_feedback f\s+WHERE f\.contact_id = l\.contact_id\s+AND f\.property_id = l\.property_id\s+AND f\.verdict = 'rejected'\s+AND f\.source = 'contact'\s+AND COALESCE\(f\.updated_at, f\.created_at\) > l\.created_at\s+\)/
    );
    expect(signals).toContain(
      "CASE s.kind WHEN 'interested' THEN 0 ELSE 1 END, s.at DESC"
    );
    expect(signals).toMatch(
      /CASE WHEN EXISTS \(\s+SELECT 1 FROM contact_property_inquiries cpi\s+WHERE cpi\.contact_id = r\.contact_id AND cpi\.property_id = r\.property_id\s+\) THEN 'inquiry_import' ELSE 'whatsapp_share' END,\s+TRUE, r\.kind, r\.at, r\.at, r\.at/
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
    expect(signals).toMatch(
      /AND NOT EXISTS \(\s+SELECT 1 FROM property_shares ps\s+WHERE ps\.account_id = r\.account_id\s+AND ps\.contact_id = r\.contact_id\s+AND ps\.property_id = r\.property_id\s+\)\s+ON CONFLICT/
    );
    const backfill = signals.slice(
      0,
      signals.indexOf(
        'CREATE OR REPLACE FUNCTION public.journey_overview_groups('
      )
    );
    expect(backfill).not.toContain('SET hidden');
  });

  it('[JRN-026] a stamp-only update never counts as activity on the item, live or backfilled', () => {
    const trigger = signals.indexOf(
      'CREATE OR REPLACE FUNCTION public.journey_items_set_updated_at()'
    );
    const update = signals.indexOf('UPDATE journey_items ji');
    expect(trigger).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(trigger);
    expect(signals).toMatch(
      /v_old\.lead_interest := NULL;\s+v_old\.lead_interest_at := NULL;\s+v_old\.updated_at := NULL;\s+v_new\.lead_interest := NULL;\s+v_new\.lead_interest_at := NULL;\s+v_new\.updated_at := NULL;\s+IF v_new IS NOT DISTINCT FROM v_old THEN\s+NEW\.updated_at := OLD\.updated_at;\s+ELSE\s+NEW\.updated_at := NOW\(\);/
    );
    expect(signals).toContain(
      'CREATE OR REPLACE TRIGGER set_journey_items_updated_at\n  BEFORE UPDATE ON journey_items\n  FOR EACH ROW EXECUTE FUNCTION public.journey_items_set_updated_at();'
    );
    expect(signals).not.toContain('DISABLE TRIGGER');
  });

  it('[CPL-004] [JRN-026] the Helper reads the lead’s own Interested answers as a signal, in its own migration', () => {
    expect(signals).not.toMatch(/\bDROP\b/);
    expect(signals).not.toContain(
      'CREATE OR REPLACE FUNCTION public.copilot_property_interest('
    );
    expect(copilot).toContain(
      'DROP FUNCTION IF EXISTS public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT);'
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
      'REVOKE ALL ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon;'
    );
    expect(copilot).toContain(
      'GRANT EXECUTE ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) TO authenticated;'
    );
  });

  it("[JRN-009] [JRN-026] a visible ledger row shows a pair only a lead's yes captured", () => {
    expect(signals).toContain(
      'CREATE OR REPLACE FUNCTION public.journey_capture_from_share()'
    );
    expect(signals).toContain("'whatsapp_share', NOT NEW.journey_visible");
    expect(signals).toContain(
      'ON CONFLICT (account_id, contact_id, property_id) DO NOTHING\n  RETURNING id INTO v_item;'
    );
    expect(signals).toMatch(
      /ELSIF NEW\.journey_visible THEN\s+UPDATE journey_items ji\s+SET hidden = FALSE\s+WHERE ji\.account_id = NEW\.account_id\s+AND ji\.contact_id = NEW\.contact_id\s+AND ji\.property_id = NEW\.property_id\s+AND ji\.hidden\s+AND EXISTS \(\s+SELECT 1 FROM journey_events e\s+WHERE e\.item_id = ji\.id\s+AND e\.event_type = 'added'\s+AND e\.reason = 'Captured from lead interest'/
    );
    expect(signals).toMatch(
      /AND e\.reason = 'Captured from lead interest'\s+\)\s+AND NOT EXISTS \(\s+SELECT 1 FROM journey_events e\s+WHERE e\.item_id = ji\.id\s+AND e\.event_type IN \('hidden', 'unhidden'\)\s+\)/
    );
    expect(signals).toContain("'unhidden', v_item_stage, v_item_stage,");
    expect(signals).toMatch(
      /'Shown by a visible capture', NEW\.created_by\s+\);\s+PERFORM journey_open_deal_for_item\(v_item\);/
    );
    expect(signals).toContain("RAISE WARNING 'journey_capture_from_share:");
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
