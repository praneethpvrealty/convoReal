import { describe, expect, it } from 'vitest';

import {
  BUNDLE_MAX_DEALS,
  BUNDLE_MIN_DEALS,
  bundleBlocker,
  bundleCandidateLabel,
  bundleCandidates,
  defaultBundleName,
  sameBuyerIds,
  type BundleCandidate,
} from './bundles';

function candidate(over: Partial<BundleCandidate> = {}): BundleCandidate {
  return {
    id: 'd',
    title: 'Deal',
    contact_id: 'sidharth',
    contact_name: 'Sidharth',
    property_title: 'JP Nagar site',
    property_unit_no: null,
    stage_name: 'Due Diligence/Contract',
    deal_group_id: null,
    ...over,
  };
}

describe('[TXW-019] bundle picker', () => {
  const anchor = { id: 'd19', contact_id: 'sidharth' };

  it('offers neither the deal itself nor a deal already bundled', () => {
    const rows = [
      candidate({ id: 'd19', property_unit_no: '19' }),
      candidate({ id: 'd20', property_unit_no: '20' }),
      candidate({ id: 'bundled', deal_group_id: 'g1', property_unit_no: '21' }),
    ];
    expect(bundleCandidates(rows, anchor).map((r) => r.id)).toEqual(['d20']);
  });

  it('lists the same buyer’s deals first, then the rest by label', () => {
    const rows = [
      candidate({
        id: 'z',
        contact_id: 'yusuf',
        contact_name: 'Yusuf',
        property_title: 'Lotus',
      }),
      candidate({ id: 'd20', property_unit_no: '20' }),
      candidate({
        id: 'a',
        contact_id: 'anand',
        contact_name: 'KP Anand',
        property_title: 'HSR land',
      }),
      candidate({ id: 'd18', property_unit_no: '18' }),
    ];
    expect(bundleCandidates(rows, anchor).map((r) => r.id)).toEqual([
      'd18',
      'd20',
      'a',
      'z',
    ]);
  });

  it('pre-ticks the same buyer’s deals and nobody else’s', () => {
    const rows = bundleCandidates(
      [
        candidate({ id: 'd20', property_unit_no: '20' }),
        candidate({ id: 'z', contact_id: 'yusuf' }),
      ],
      anchor
    );
    expect(sameBuyerIds(rows, anchor)).toEqual(['d20']);
    expect(sameBuyerIds(rows, { id: 'd19', contact_id: null })).toEqual([]);
  });

  it('labels a deal by unit number, then property, then its own title', () => {
    expect(bundleCandidateLabel(candidate({ property_unit_no: ' 19 ' }))).toBe(
      'Property No. 19'
    );
    expect(bundleCandidateLabel(candidate({ property_title: 'Lotus' }))).toBe(
      'Lotus'
    );
    expect(
      bundleCandidateLabel(
        candidate({ property_title: null, title: 'Own title' })
      )
    ).toBe('Own title');
  });

  it('names the bundle after the buyer', () => {
    expect(defaultBundleName('Sidharth')).toBe('Sidharth — linked purchases');
    expect(defaultBundleName('  ')).toBe('Linked purchases');
    expect(defaultBundleName(null)).toBe('Linked purchases');
  });

  it('holds the route’s limits: a name, two to twenty deals', () => {
    expect(bundleBlocker('', 2)).toBe('Give the bundle a name.');
    expect(bundleBlocker('x'.repeat(121), 2)).toMatch(/under 120/);
    expect(bundleBlocker('Sidharth', BUNDLE_MIN_DEALS - 1)).toMatch(
      /at least one more/
    );
    expect(bundleBlocker('Sidharth', BUNDLE_MAX_DEALS + 1)).toMatch(
      /at most 20/
    );
    expect(bundleBlocker('Sidharth', 2)).toBeNull();
    expect(bundleBlocker('Sidharth', BUNDLE_MAX_DEALS)).toBeNull();
  });
});
