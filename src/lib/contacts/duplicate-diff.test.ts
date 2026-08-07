import { describe, it, expect } from 'vitest';
import { diffContacts } from '@/lib/contacts/duplicate-diff';

// The pair this was written for: two live contacts both named Arun Kumar,
// one an Owner reached on WhatsApp in June, one a Housing buyer with a
// ₹14.7 Cr budget in August. Same name, different people — and from the
// panel you could previously see only the name and the source.
const OWNER = {
  phone: '+919663549494',
  source: 'WhatsApp',
  classification: 'Owner',
  status: 'active',
  max_budget: null,
  areas_of_interest: [],
};
const BUYER = {
  phone: '+918217878362',
  source: 'Housing',
  classification: 'Buyer',
  status: 'active',
  max_budget: 147000000,
  areas_of_interest: ['Bannergatta Road', 'Sector 6 HSR Layout'],
};

describe('diffContacts', () => {
  it('calls it a conflict when both records answer differently', () => {
    const diff = diffContacts([OWNER, BUYER]);
    const classification = diff.find((d) => d.label === 'Classification');
    expect(classification?.values).toEqual(['Owner', 'Buyer']);
    expect(classification?.conflict).toBe(true);
  });

  it('does not call it a conflict when only one record holds a value', () => {
    const diff = diffContacts([OWNER, BUYER]);
    const budget = diff.find((d) => d.label === 'Max budget');
    expect(budget?.values).toEqual(['', '₹14.7 Cr']);
    expect(budget?.conflict).toBe(false);
  });

  it('leaves out fields the records agree on', () => {
    const diff = diffContacts([OWNER, BUYER]);
    expect(diff.find((d) => d.label === 'Status')).toBeUndefined();
  });

  it('leaves out fields neither record has', () => {
    const diff = diffContacts([OWNER, BUYER]);
    expect(diff.find((d) => d.label === 'Requirements')).toBeUndefined();
  });

  it('reads an empty list as no value rather than as a difference', () => {
    const diff = diffContacts([
      { areas_of_interest: [] },
      { areas_of_interest: null },
    ]);
    expect(diff).toEqual([]);
  });

  it('has nothing to compare against a single record', () => {
    expect(diffContacts([OWNER])).toEqual([]);
  });
});

describe('budget formatting', () => {
  it('trims only the decimals a figure does not earn', () => {
    const at = (max_budget: number) =>
      diffContacts([{ max_budget }, { max_budget: null }])[0].values[0];
    expect(at(147000000)).toBe('₹14.7 Cr');
    expect(at(150000000)).toBe('₹15 Cr');
    expect(at(10500000)).toBe('₹1.05 Cr');
    expect(at(4500000)).toBe('₹45 L');
    expect(at(90000)).toBe('₹90,000');
  });
});
