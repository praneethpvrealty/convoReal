import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildExternalPortalView,
  canStakeholderOpenDocument,
  partiesFromStakeholders,
  stakeholderTwinOn,
  type ExternalDealSource,
} from './external-view';
import { STAKEHOLDER_HIDDEN_DEAL_FIELDS } from './financials';
import type { DealStakeholder } from './stakeholders';

function person(
  id: string,
  side: DealStakeholder['side'],
  extra: Partial<DealStakeholder> = {}
): DealStakeholder {
  return {
    id,
    account_id: 'acc',
    deal_id: 'deal',
    contact_id: null,
    name: id,
    phone: null,
    email: null,
    role: side === 'seller' ? 'seller' : 'buyer',
    side,
    notes: null,
    created_by: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...extra,
  };
}

const adithi19 = person('adithi-19', 'buyer', {
  contact_id: 'c-adithi',
  deal_id: 'deal-19',
});
const adithi20 = person('adithi-20', 'buyer', {
  contact_id: 'c-adithi',
  deal_id: 'deal-20',
});
const seller19 = person('seller-19', 'seller', {
  deal_id: 'deal-19',
  phone: '919000000019',
});
const seller20 = person('seller-20', 'seller', {
  deal_id: 'deal-20',
  phone: '919000000020',
});
const broker = person('broker', 'internal', { role: 'broker' });

const site19: ExternalDealSource = {
  id: 'deal-19',
  title: 'Adithi — Site #19',
  status: 'open',
  property_label: 'Property No. 19',
  deal_group_id: 'g1',
  stakeholders: [adithi19, seller19, broker],
  milestones: [
    {
      id: 'm1',
      title: 'Token paid',
      status: 'completed',
      position: 0,
      target_date: null,
      completed_at: '2026-09-02T00:00:00Z',
      visibility: 'all_stakeholders',
    },
    {
      id: 'm2',
      title: 'Seller to produce mother deed',
      status: 'in_progress',
      position: 1,
      target_date: '2026-09-21',
      completed_at: null,
      visibility: 'seller_side',
    },
    {
      id: 'm3',
      title: 'Loan sanction',
      status: 'pending',
      position: 2,
      target_date: null,
      completed_at: null,
      visibility: 'buyer_side',
    },
    {
      id: 'm4',
      title: 'Push seller on date',
      status: 'pending',
      position: 3,
      target_date: null,
      completed_at: null,
      visibility: 'internal',
    },
  ],
  events: [
    {
      id: 'e1',
      event_type: 'note_added',
      title: 'Legal documents collected',
      created_at: '2026-09-10T00:00:00Z',
      visibility: 'all_stakeholders',
    },
    {
      id: 'e2',
      event_type: 'financials_updated',
      title: 'Financials updated (2 fields)',
      created_at: '2026-09-11T00:00:00Z',
      visibility: 'internal',
    },
  ],
  documents: [
    {
      id: 'd1',
      title: 'Draft agreement',
      category: 'agreement',
      status: 'reviewed',
      expires_at: null,
      superseded_by: null,
      mime_type: 'application/pdf',
      visibility: 'all_stakeholders',
    },
    {
      id: 'd2',
      title: 'Seller Aadhaar',
      category: 'identity',
      status: null,
      expires_at: null,
      superseded_by: null,
      mime_type: 'image/jpeg',
      visibility: 'internal',
    },
    {
      id: 'd3',
      title: 'Loan sanction letter',
      category: 'other',
      status: null,
      expires_at: '2026-12-01',
      superseded_by: null,
      mime_type: 'application/pdf',
      visibility: 'buyer_side',
    },
  ],
};

const site20: ExternalDealSource = {
  id: 'deal-20',
  title: 'Adithi — Site #20',
  status: 'open',
  property_label: 'Property No. 20',
  deal_group_id: 'g1',
  stakeholders: [adithi20, seller20],
  milestones: [
    {
      id: 'n1',
      title: 'Seller documents under review',
      status: 'in_progress',
      position: 0,
      target_date: null,
      completed_at: null,
      visibility: 'all_stakeholders',
    },
    {
      id: 'n2',
      title: 'Seller to clear khata',
      status: 'pending',
      position: 1,
      target_date: null,
      completed_at: null,
      visibility: 'seller_side',
    },
  ],
  events: [],
  documents: [],
};

describe('partiesFromStakeholders', () => {
  it('groups by side and leaves internal people out', () => {
    expect(partiesFromStakeholders([adithi19, seller19, broker])).toEqual({
      buyer_party_ids: ['adithi-19'],
      seller_party_ids: ['seller-19'],
    });
  });
});

describe('[TXW-010] the external view passes everything through the resolver', () => {
  it('shows a seller only their side and the shared items, with honest progress', () => {
    const view = buildExternalPortalView({
      stakeholder: seller19,
      deal: site19,
      siblings: [site19, site20],
    });
    expect(view).not.toBeNull();
    expect(view!.deal.milestones.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(view!.deal.timeline.map((e) => e.id)).toEqual(['e1']);
    expect(view!.deal.documents.map((d) => d.id)).toEqual(['d1']);
    expect(view!.deal.progress).toEqual({ total: 4, done: 1 });
    expect(view!.bundle).toEqual([]);
    const text = JSON.stringify(view);
    expect(text).not.toContain('Site #20');
    expect(text).not.toContain('Loan sanction');
    expect(text).not.toContain('Push seller');
    expect(text).not.toContain('Aadhaar');
    for (const field of STAKEHOLDER_HIDDEN_DEAL_FIELDS)
      expect(text).not.toContain(`"${field}"`);
    expect(text).not.toContain('actor_name');
  });

  it('shows the buyer both plots of the bundle because they are the same person on each', () => {
    const view = buildExternalPortalView({
      stakeholder: adithi19,
      deal: site19,
      siblings: [site19, site20],
    });
    expect(view!.deal.milestones.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(view!.deal.documents.map((d) => d.id)).toEqual(['d1', 'd3']);
    expect(view!.bundle.map((d) => d.id)).toEqual(['deal-20']);
    expect(view!.bundle[0].milestones.map((m) => m.id)).toEqual(['n1']);
    expect(JSON.stringify(view)).not.toContain('clear khata');
  });

  it('[TXW-005] the other seller never sees plot #19', () => {
    const view = buildExternalPortalView({
      stakeholder: seller20,
      deal: site20,
      siblings: [site19, site20],
    });
    expect(view!.bundle).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('Site #19');
  });

  it('an internal-side stakeholder gets no external view at all', () => {
    expect(
      buildExternalPortalView({ stakeholder: broker, deal: site19 })
    ).toBeNull();
  });

  it('finds the same person on a bundle sibling, and nobody else', () => {
    expect(stakeholderTwinOn(adithi19, site20)?.id).toBe('adithi-20');
    expect(stakeholderTwinOn(seller19, site20)).toBeNull();
    expect(stakeholderTwinOn(broker, site20)).toBeNull();
    const documents = readFileSync(
      join(
        process.cwd(),
        'src/app/api/public/deal-share/[token]/documents/[docId]/route.ts'
      ),
      'utf8'
    );
    expect(documents).toContain('stakeholderTwinOn(stakeholder, sibling)');
    expect(documents).not.toMatch(/\.eq\('deal_id', link\.deal_id\)/);
  });

  it('re-checks a document at the byte boundary with the same rule', () => {
    expect(
      canStakeholderOpenDocument(seller19, { visibility: 'all_stakeholders' })
    ).toBe(true);
    expect(
      canStakeholderOpenDocument(seller19, { visibility: 'buyer_side' })
    ).toBe(false);
    expect(
      canStakeholderOpenDocument(seller19, { visibility: 'internal' })
    ).toBe(false);
    expect(
      canStakeholderOpenDocument(broker, { visibility: 'all_stakeholders' })
    ).toBe(false);
  });
});

describe('[TXW-010] every public deal-share route reads through the external view', () => {
  const dir = join(process.cwd(), 'src/app/api/public/deal-share');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((name) => {
      const p = join(d, name);
      return statSync(p).isDirectory()
        ? walk(p)
        : name === 'route.ts'
          ? [p]
          : [];
    });

  it('never selects deal financial columns or builds a payload outside the resolver', () => {
    const routes = walk(dir);
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const route of routes) {
      const source = readFileSync(route, 'utf8');
      for (const field of STAKEHOLDER_HIDDEN_DEAL_FIELDS) {
        expect(source, `${route} names ${field}`).not.toMatch(
          new RegExp(`\\\\b${field}\\\\b`)
        );
      }
      expect(source, route).toMatch(
        /@\/lib\/deals\/(external-view|share-links)/
      );
      expect(source, route).not.toMatch(
        /auth\.(signInWithOtp|signUp|admin\.createUser|verifyOtp)/
      );
    }
  });
});
