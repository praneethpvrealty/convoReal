import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEAL_EVENT_LABELS, parseEventSource, parseNoteInput } from './events';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260918010000_transaction_workspace.sql'),
  'utf8'
);

describe('[TXW-002] deal_events are immutable in the database', () => {
  it('grants only SELECT and INSERT to authenticated', () => {
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON deal_events FROM anon, authenticated;/
    );
    expect(migration).toMatch(/GRANT SELECT, INSERT ON deal_events TO authenticated;/);
  });

  it('has no UPDATE, DELETE or FOR ALL policy — the journey_events mistake', () => {
    const policies = migration.match(/CREATE POLICY [a-z_]+ ON deal_events[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(2);
    for (const policy of policies) {
      expect(policy).not.toMatch(/FOR ALL/);
      expect(policy).not.toMatch(/FOR UPDATE/);
      expect(policy).not.toMatch(/FOR DELETE/);
    }
  });

  it('pins the actor to the caller on insert', () => {
    expect(migration).toMatch(/actor_id = \(SELECT auth\.uid\(\)\)/);
  });

  it('refuses UPDATE and DELETE by trigger, allowing only the cascade from a deleted deal', () => {
    expect(migration).toMatch(/CREATE TRIGGER deal_events_immutable_trigger\s+BEFORE UPDATE OR DELETE ON deal_events/);
    expect(migration).toMatch(/IF TG_OP = 'UPDATE' THEN\s+RAISE EXCEPTION 'deal_events are immutable'/);
    expect(migration).toMatch(/IF EXISTS \(SELECT 1 FROM deals WHERE deals\.id = OLD\.deal_id\) THEN\s+RAISE EXCEPTION/);
  });

  it('every event type the code can write is accepted by the CHECK', () => {
    const check = migration.match(/event_type TEXT NOT NULL CHECK \(event_type IN \(([\s\S]*?)\)\)/);
    expect(check).not.toBeNull();
    const allowed = new Set(Array.from(check![1].matchAll(/'([a-z_]+)'/g), (m) => m[1]));
    for (const type of Object.keys(DEAL_EVENT_LABELS)) {
      expect(allowed.has(type), type).toBe(true);
    }
  });
});

describe('parseNoteInput', () => {
  it('trims and bounds a note and reads the source', () => {
    expect(parseNoteInput({ note: '  Seller wants Friday  ', source: 'mobile' })).toEqual({
      ok: true,
      value: { note: 'Seller wants Friday', source: 'mobile' },
    });
    expect(parseNoteInput({ note: '' })).toEqual({ ok: false, error: 'note is required' });
    expect(parseNoteInput({ note: 'x'.repeat(2001) })).toEqual({
      ok: false,
      error: 'Note must be 2,000 characters or less',
    });
  });

  it('defaults an unknown source to web', () => {
    expect(parseEventSource('system')).toBe('web');
    expect(parseEventSource('api')).toBe('api');
  });
});
