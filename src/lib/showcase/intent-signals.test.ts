import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('[PRP-059] shortlist and WhatsApp taps travel as showcase events', () => {
  const migration = read(
    'supabase/migrations/20261109093000_showcase_event_types.sql'
  );
  const trigger = read(
    'supabase/migrations/20261109093001_location_request_enquiry.sql'
  );

  it('admits the two intents into the showcase_events type constraint', () => {
    expect(migration).toMatch(
      /CHECK \(event_type IN \([^)]*'shortlist'[^)]*'whatsapp_click'[^)]*\)\)/
    );
    expect(read('src/lib/pulse/tracker.ts')).toMatch(/'shortlist'/);
    expect(read('src/lib/pulse/tracker.ts')).toMatch(/'whatsapp_click'/);
  });

  it('records an approved exact-location request as an enquiry on the listing, without a DROP', () => {
    expect(trigger).toMatch(
      /CREATE OR REPLACE TRIGGER record_location_request_enquiry\s+AFTER INSERT OR UPDATE OF status ON property_location_requests/
    );
    expect(trigger).not.toMatch(/DROP/);
    expect(trigger).toContain("NEW.status <> 'approved'");
    expect(trigger).toContain('NEW.contact_id IS NULL');
    expect(trigger).toContain("COALESCE(NEW.scope, 'location') <> 'location'");
    expect(trigger).toContain("COALESCE(r.scope, 'location') = 'location'");
    expect(trigger).toContain("'Location request'");
    expect(trigger).toContain(
      'ON CONFLICT (contact_id, property_id) DO NOTHING'
    );
  });
});
