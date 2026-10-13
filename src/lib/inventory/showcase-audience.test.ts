import { describe, it, expect } from 'vitest';
import {
  isAgentContact,
  withheldFromCoBrokers,
  withheldShareNotice,
} from '@/lib/inventory/showcase-audience';

const picks = [
  { id: 'open', title: 'Open flat' },
  { id: 'quiet', title: 'Quiet villa', showcase_audience: 'buyers_only' },
  { id: 'all', title: 'Listed shop', showcase_audience: 'all' },
];

describe('withheldFromCoBrokers', () => {
  it('[PRP-046] withholds every buyers-only pick when the share goes out as the co-broker link', () => {
    const withheld = withheldFromCoBrokers(picks, {
      coBrokerAudience: true,
      recipients: [],
    });
    expect(withheld.map((p) => p.id)).toEqual(['quiet']);
  });

  it('[PRP-046] withholds them when any recipient is an Agent-classified contact', () => {
    const withheld = withheldFromCoBrokers(picks, {
      coBrokerAudience: false,
      recipients: [{ classification: 'Buyer' }, { classification: 'Agent' }],
    });
    expect(withheld.map((p) => p.id)).toEqual(['quiet']);
    expect(isAgentContact({ classification: 'Agent' })).toBe(true);
    expect(isAgentContact({ classification: 'Owner' })).toBe(false);
    expect(isAgentContact({})).toBe(false);
  });

  it('[PRP-046] withholds nothing from a buyer share', () => {
    expect(
      withheldFromCoBrokers(picks, {
        coBrokerAudience: false,
        recipients: [{ classification: 'Buyer' }, {}],
      })
    ).toEqual([]);
  });

  it('[PRP-046] says what to do about it, counted', () => {
    expect(withheldShareNotice(1)).toContain(
      'One picked listing is buyers only'
    );
    expect(withheldShareNotice(3)).toContain(
      '3 picked listings are buyers only'
    );
    expect(withheldShareNotice(1)).toContain('switch the audience to clients');
  });
});
