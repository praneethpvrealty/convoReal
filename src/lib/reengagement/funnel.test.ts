import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  funnelStages,
  REENGAGEMENT_TEMPLATE_NAMES,
  leadStage,
  requirementSummary,
  readyToShortlist,
} from './funnel';
import type { ReengagementLead, ReengagementSummary } from './queries';

function summary(over: Partial<ReengagementSummary> = {}): ReengagementSummary {
  return {
    batches: 1,
    leads: 200,
    sent: 200,
    delivered: 190,
    read: 150,
    replied: 60,
    requirementUpdated: 40,
    matched: 25,
    failed: 0,
    ...over,
  };
}

function lead(over: Partial<ReengagementLead> = {}): ReengagementLead {
  return {
    contactId: 'c1',
    contactName: 'Praneeth',
    contactPhone: '+919876543210',
    broadcastId: 'b1',
    broadcastName: 'Lead re-engagement',
    batchSentAt: '2026-08-07T05:00:00Z',
    status: 'sent',
    repliedAt: null,
    requirementUpdatedAt: null,
    budgetMin: null,
    budgetMax: null,
    areas: [],
    matchEventId: null,
    matchCount: 0,
    matchEventStatus: null,
    ...over,
  };
}

describe('funnelStages', () => {
  it('reports each stage as a share of the uploaded list, not of the previous stage', () => {
    const stages = funnelStages(summary());
    expect(stages.map((s) => [s.key, s.value, s.percent])).toEqual([
      ['sent', 200, 100],
      ['delivered', 190, 95],
      ['read', 150, 75],
      ['replied', 60, 30],
      ['requirementUpdated', 40, 20],
      ['matched', 25, 13],
    ]);
  });

  it('never divides by zero before the first batch goes out', () => {
    const stages = funnelStages(
      summary({
        leads: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        requirementUpdated: 0,
        matched: 0,
      })
    );
    expect(stages.every((s) => s.percent === 0 && s.value === 0)).toBe(true);
  });
});

describe('leadStage', () => {
  it('reports the furthest point reached, matched winning over earlier stages', () => {
    expect(leadStage(lead({ matchCount: 3, status: 'replied' }))).toBe(
      'matched'
    );
    expect(
      leadStage(
        lead({
          requirementUpdatedAt: '2026-08-07T06:00:00Z',
          status: 'replied',
        })
      )
    ).toBe('updated');
    expect(leadStage(lead({ repliedAt: '2026-08-07T06:00:00Z' }))).toBe(
      'replied'
    );
    expect(leadStage(lead({ status: 'delivered' }))).toBe('delivered');
    expect(leadStage(lead({ status: 'sent' }))).toBe('sent');
    expect(leadStage(lead({ status: 'failed' }))).toBe('failed');
    expect(leadStage(lead({ status: 'pending' }))).toBe('pending');
  });

  it('treats a replied status with no timestamp as replied', () => {
    expect(leadStage(lead({ status: 'replied', repliedAt: null }))).toBe(
      'replied'
    );
  });
});

describe('requirementSummary', () => {
  it('renders a budget range with areas', () => {
    expect(
      requirementSummary(
        lead({
          budgetMin: 10000000,
          budgetMax: 15000000,
          areas: ['Whitefield', 'HSR'],
        })
      )
    ).toBe('₹1 Cr – ₹1.50 Cr · Whitefield, HSR');
  });

  it('handles a one-sided budget', () => {
    expect(requirementSummary(lead({ budgetMax: 15000000 }))).toBe(
      'up to ₹1.50 Cr'
    );
    expect(requirementSummary(lead({ budgetMin: 10000000 }))).toBe(
      'from ₹1 Cr'
    );
  });

  it('caps the area list and counts the overflow', () => {
    expect(requirementSummary(lead({ areas: ['A', 'B', 'C', 'D', 'E'] }))).toBe(
      'A, B, C +2'
    );
  });

  it('returns empty rather than inventing a requirement we were never told', () => {
    expect(requirementSummary(lead())).toBe('');
  });
});

describe('readyToShortlist', () => {
  it('keeps matched leads whose shortlist has not gone out yet', () => {
    const rows = [
      lead({ contactId: 'a', matchCount: 2, matchEventStatus: 'new' }),
      lead({ contactId: 'b', matchCount: 2, matchEventStatus: 'sent' }),
      lead({ contactId: 'c', matchCount: 0 }),
    ];
    expect(readyToShortlist(rows).map((l) => l.contactId)).toEqual(['a']);
  });
});

describe('REENGAGEMENT_TEMPLATE_NAMES vs is_reengagement_template()', () => {
  // The SQL predicate decides whether the broadcast page shows an
  // outcome panel; this list is its client-side twin. They drifted
  // once already: the notice template was renamed after the migration
  // was written, so listing_status_notice reached the DB by hand but
  // never reached the file, and a fresh environment would have lost
  // the panel for every property-anchored batch.
  const sql = readFileSync(
    'supabase/migrations/225_reengagement_signed_notice.sql',
    'utf8'
  );
  const inSql = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it('every name the code counts is a name the database counts', () => {
    for (const name of REENGAGEMENT_TEMPLATE_NAMES) {
      expect(inSql, name).toContain(name);
    }
  });

  it('and the reverse, so a retired name is dropped from both', () => {
    for (const name of inSql) {
      expect(REENGAGEMENT_TEMPLATE_NAMES, name).toContain(name);
    }
  });
});
