import { describe, expect, it } from 'vitest';
import {
  combinedReadRate,
  rate,
  summarizeTemplates,
  totalSends,
  type TemplateAnalyticsRow,
} from './template-analytics';

function row(overrides: Partial<TemplateAnalyticsRow>): TemplateAnalyticsRow {
  return {
    template_id: 't1',
    name: 'welcome_lead',
    category: 'Marketing',
    language: 'en_US',
    status: 'Approved',
    quality_score: 'GREEN',
    broadcast_campaigns: 0,
    broadcast_sent: 0,
    broadcast_delivered: 0,
    broadcast_read: 0,
    broadcast_replied: 0,
    broadcast_failed: 0,
    direct_sends: 0,
    direct_delivered: 0,
    direct_read: 0,
    direct_failed: 0,
    last_used_at: null,
    ...overrides,
  };
}

describe('rate helpers', () => {
  it('computes percentages and returns null for zero denominators', () => {
    expect(rate(30, 120)).toBeCloseTo(25);
    expect(rate(0, 0)).toBeNull();
  });

  it('combines broadcast and direct channels', () => {
    const r = row({
      broadcast_sent: 80,
      broadcast_read: 40,
      direct_sends: 20,
      direct_read: 10,
    });
    expect(totalSends(r)).toBe(100);
    expect(combinedReadRate(r)).toBeCloseTo(50);
    expect(combinedReadRate(row({}))).toBeNull();
  });
});

describe('summarizeTemplates', () => {
  it('totals sends and computes read/reply rates across templates', () => {
    const totals = summarizeTemplates([
      row({
        broadcast_sent: 100,
        broadcast_read: 60,
        broadcast_replied: 20,
        direct_sends: 50,
        direct_read: 30,
      }),
      row({
        template_id: 't2',
        status: 'Draft',
        direct_sends: 50,
        direct_read: 30,
      }),
    ]);

    expect(totals.templates).toBe(2);
    expect(totals.approved).toBe(1);
    expect(totals.totalSends).toBe(200);
    expect(totals.readRate).toBeCloseTo(60);
    expect(totals.replyRate).toBeCloseTo(20);
  });

  it('returns null rates with no sends', () => {
    const totals = summarizeTemplates([row({})]);
    expect(totals.readRate).toBeNull();
    expect(totals.replyRate).toBeNull();
  });
});
