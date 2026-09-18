import { describe, expect, it } from 'vitest';

import { STAKEHOLDER_HIDDEN_DEAL_FIELDS } from './financials';
import {
  projectBundleForAudience,
  projectDealForAudience,
  sideCanSee,
  type ProjectableDeal,
} from './visibility';

// Adithi buys Sites #19 and #20 from two different sellers. One bundle,
// two deals, and the sellers must never see each other.
const ADITHI = 'contact-adithi';
const SELLER_19 = 'contact-seller-19';
const SELLER_20 = 'contact-seller-20';

const site19: ProjectableDeal = {
  id: 'deal-19',
  title: 'Adithi — Site #19',
  value: 16200000,
  agreed_consideration: 16200000,
  registered_consideration: 14000000,
  notes: 'seller 19 will accept 1.58 if registration is this month',
  parties: { buyer_contact_ids: [ADITHI], seller_contact_ids: [SELLER_19] },
  items: [
    { visibility: 'all_stakeholders', title: 'Legal documents collected' },
    { visibility: 'seller_side', title: 'Seller to produce mother deed' },
    { visibility: 'buyer_side', title: 'Loan sanction due' },
    { visibility: 'internal', title: 'Seller anxious, push for registration date' },
  ],
};

const site20: ProjectableDeal = {
  id: 'deal-20',
  title: 'Adithi — Site #20',
  value: 15800000,
  agreed_consideration: 15800000,
  registered_consideration: 13500000,
  notes: 'seller 20 has a competing offer',
  parties: { buyer_contact_ids: [ADITHI], seller_contact_ids: [SELLER_20] },
  items: [
    { visibility: 'all_stakeholders', title: 'Seller documents under review' },
    { visibility: 'seller_side', title: 'Seller to clear khata' },
  ],
};

describe('sideCanSee', () => {
  it('maps each visibility to the sides it admits', () => {
    expect(sideCanSee('buyer', 'internal')).toBe(false);
    expect(sideCanSee('seller', 'internal')).toBe(false);
    expect(sideCanSee('buyer', 'buyer_side')).toBe(true);
    expect(sideCanSee('seller', 'buyer_side')).toBe(false);
    expect(sideCanSee('seller', 'seller_side')).toBe(true);
    expect(sideCanSee('buyer', 'all_stakeholders')).toBe(true);
  });
});

describe('[TXW-005] bundle isolation', () => {
  it('a seller sees only their own plot, with no internal fields or other side items', () => {
    const view = projectBundleForAudience([site19, site20], {
      kind: 'external',
      side: 'seller',
      contactId: SELLER_19,
    });
    expect(view.map((d) => d.deal.id)).toEqual(['deal-19']);
    const [only] = view;
    for (const field of STAKEHOLDER_HIDDEN_DEAL_FIELDS) {
      expect(only.deal, field).not.toHaveProperty(field);
    }
    expect(only.deal).not.toHaveProperty('parties');
    expect(only.items.map((i) => i.title)).toEqual([
      'Legal documents collected',
      'Seller to produce mother deed',
    ]);
    expect(JSON.stringify(view)).not.toContain('Site #20');
    expect(JSON.stringify(view)).not.toContain('competing offer');
  });

  it('the other seller likewise never sees plot #19', () => {
    const view = projectBundleForAudience([site19, site20], {
      kind: 'external',
      side: 'seller',
      contactId: SELLER_20,
    });
    expect(view.map((d) => d.deal.id)).toEqual(['deal-20']);
    expect(JSON.stringify(view)).not.toContain('Site #19');
    expect(JSON.stringify(view)).not.toContain('1.58');
  });

  it('the buyer sees both plots, buyer-side items only, and no internal fields', () => {
    const view = projectBundleForAudience([site19, site20], {
      kind: 'external',
      side: 'buyer',
      contactId: ADITHI,
    });
    expect(view.map((d) => d.deal.id)).toEqual(['deal-19', 'deal-20']);
    expect(view[0].items.map((i) => i.title)).toEqual([
      'Legal documents collected',
      'Loan sanction due',
    ]);
    const text = JSON.stringify(view);
    expect(text).not.toContain('registered_consideration');
    expect(text).not.toContain('mother deed');
    expect(text).not.toContain('anxious');
  });

  it('a stranger sees nothing — not even an id', () => {
    expect(
      projectBundleForAudience([site19, site20], {
        kind: 'external',
        side: 'buyer',
        contactId: 'contact-someone-else',
      })
    ).toEqual([]);
    expect(
      projectDealForAudience(site19, { kind: 'external', side: 'seller', contactId: ADITHI })
    ).toBeNull();
  });

  it('internal members see everything, unchanged', () => {
    const view = projectDealForAudience(site19, { kind: 'internal' });
    expect(view?.deal).toHaveProperty('registered_consideration', 14000000);
    expect(view?.items).toHaveLength(4);
  });
});
