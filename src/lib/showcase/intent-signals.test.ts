import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('[PRP-058] shortlist and WhatsApp taps travel as showcase events', () => {
  const migration = read(
    'supabase/migrations/20261109093000_showcase_intent_signals.sql'
  );

  it('admits the two intents into the showcase_events type constraint', () => {
    expect(migration).toMatch(
      /CHECK \(event_type IN \([^)]*'shortlist'[^)]*'whatsapp_click'[^)]*\)\)/
    );
    expect(read('src/lib/pulse/tracker.ts')).toMatch(/'shortlist'/);
    expect(read('src/lib/pulse/tracker.ts')).toMatch(/'whatsapp_click'/);
  });

  it('records an approved exact-location request as an enquiry on the listing', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER record_location_request_enquiry\s+AFTER INSERT OR UPDATE OF status ON property_location_requests/
    );
    expect(migration).toContain("NEW.status <> 'approved'");
    expect(migration).toContain('NEW.contact_id IS NULL');
    expect(migration).toContain(
      "COALESCE(NEW.scope, 'location') <> 'location'"
    );
    expect(migration).toContain("COALESCE(r.scope, 'location') = 'location'");
    expect(migration).toContain("'Location request'");
    expect(migration).toContain(
      'ON CONFLICT (contact_id, property_id) DO NOTHING'
    );
  });
});
