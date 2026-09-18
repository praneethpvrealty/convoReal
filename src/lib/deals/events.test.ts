import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEAL_EVENT_LABELS,
  PHASE_2_EVENT_TYPES,
  parseEventSource,
  parseNoteInput,
} from './events';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260918010000_transaction_workspace.sql'
  ),
  'utf8'
);

describe('[TXW-002] deal_events are immutable in the database', () => {
  it('grants only SELECT and INSERT to authenticated', () => {
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON deal_events FROM anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT ON deal_events TO authenticated;/
    );
  });

  it('has no UPDATE, DELETE or FOR ALL policy — the journey_events mistake', () => {
    const policies =
      migration.match(/CREATE POLICY [a-z_]+ ON deal_events[\s\S]*?;/g) ?? [];
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
    expect(migration).toMatch(
      /CREATE TRIGGER deal_events_immutable_trigger\s+BEFORE UPDATE OR DELETE ON deal_events/
    );
    expect(migration).toMatch(
      /IF TG_OP = 'UPDATE' THEN\s+RAISE EXCEPTION 'deal_events are immutable'/
    );
    expect(migration).toMatch(
      /IF EXISTS \(SELECT 1 FROM deals WHERE deals\.id = OLD\.deal_id\) THEN\s+RAISE EXCEPTION/
    );
  });

  it('every event type the code can write is accepted by a CHECK', () => {
    const phase2 = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260918030100_transaction_workspace_share_events.sql'
      ),
      'utf8'
    );
    const initial = migration.match(
      /event_type TEXT NOT NULL CHECK \(event_type IN \(([\s\S]*?)\)\)/
    );
    const widened = phase2.match(/CHECK \(event_type IN \(([\s\S]*?)\)\)/);
    expect(initial).not.toBeNull();
    expect(widened).not.toBeNull();
    const first = new Set(
      Array.from(initial![1].matchAll(/'([a-z_]+)'/g), (m) => m[1])
    );
    const latest = new Set(
      Array.from(widened![1].matchAll(/'([a-z_]+)'/g), (m) => m[1])
    );
    for (const type of first)
      expect(latest.has(type), `${type} dropped`).toBe(true);
    for (const type of Object.keys(DEAL_EVENT_LABELS)) {
      expect(latest.has(type), type).toBe(true);
      if (!first.has(type)) expect(PHASE_2_EVENT_TYPES).toContain(type);
    }
  });
});

describe('parseNoteInput', () => {
  it('trims and bounds a note and reads the source', () => {
    expect(
      parseNoteInput({ note: '  Seller wants Friday  ', source: 'mobile' })
    ).toEqual({
      ok: true,
      value: {
        note: 'Seller wants Friday',
        source: 'mobile',
        visibility: 'internal',
      },
    });
    expect(parseNoteInput({ note: '' })).toEqual({
      ok: false,
      error: 'note is required',
    });
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

describe('every Transaction Workspace mutation refuses read-only members', () => {
  const routes = [
    'src/app/api/journey/convert-to-deal/route.ts',
    'src/app/api/deals/[id]/events/route.ts',
    'src/app/api/deals/[id]/milestones/route.ts',
    'src/app/api/deals/[id]/milestones/[milestoneId]/route.ts',
    'src/app/api/deals/[id]/financials/route.ts',
    'src/app/api/deals/[id]/documents/route.ts',
    'src/app/api/deals/[id]/documents/[docId]/route.ts',
    'src/app/api/deal-groups/route.ts',
    'src/app/api/todos/route.ts',
    'src/app/api/todos/[id]/route.ts',
  ];

  it.each(routes)('%s gates writes on requireWriteRole', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8');
    const handlers =
      source.match(/export async function (POST|PATCH|PUT|DELETE)\(/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) {
      const start = source.indexOf(handler);
      const next = source.indexOf('\nexport async function ', start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      expect(body, handler).toContain("requireWriteRole('agent')");
      expect(body, handler).not.toContain("requireRole('agent')");
    }
  });
});
