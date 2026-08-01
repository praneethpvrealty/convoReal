import { describe, expect, it } from 'vitest';
import {
  conversionRate,
  summarizeLeadSources,
  type LeadSourceRow,
} from './source-analytics';

function row(overrides: Partial<LeadSourceRow>): LeadSourceRow {
  return {
    source: 'WhatsApp',
    contacts_added: 0,
    deals_created: 0,
    deals_won: 0,
    won_value: 0,
    ...overrides,
  };
}

describe('conversionRate', () => {
  it('computes deals per contact and returns null without contacts', () => {
    expect(
      conversionRate({ contacts_added: 40, deals_created: 10 })
    ).toBeCloseTo(25);
    expect(conversionRate({ contacts_added: 0, deals_created: 3 })).toBeNull();
  });
});

describe('summarizeLeadSources', () => {
  it('totals sources and picks the top source by contacts added', () => {
    const summary = summarizeLeadSources([
      row({ source: 'MagicBricks', contacts_added: 30, deals_created: 6 }),
      row({
        source: 'WhatsApp',
        contacts_added: 50,
        deals_created: 5,
        deals_won: 2,
        won_value: 200000,
      }),
      row({ source: 'Unknown', deals_won: 1, won_value: 50000 }),
    ]);

    expect(summary.sources).toBe(3);
    expect(summary.contactsAdded).toBe(80);
    expect(summary.dealsCreated).toBe(11);
    expect(summary.dealsWon).toBe(3);
    expect(summary.wonValue).toBe(250000);
    expect(summary.topSource?.source).toBe('WhatsApp');
  });

  it('handles empty input', () => {
    const summary = summarizeLeadSources([]);
    expect(summary.sources).toBe(0);
    expect(summary.topSource).toBeNull();
  });
});
