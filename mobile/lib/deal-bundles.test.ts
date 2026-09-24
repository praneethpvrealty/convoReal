import { describe, expect, it } from 'vitest';

import {
  BUNDLE_MAX_DEALS,
  bundleBlocker,
  bundleCandidateLabel,
  bundleCandidates,
  defaultBundleName,
  sameBuyerIds,
  type BundleCandidate,
} from './deal-workspace';

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

describe('[TXW-019] the bundle picker mirrors the web rule', () => {
  const anchor = { id: 'd19', contact_id: 'sidharth' };

  it('offers the same buyer first, never itself, never a bundled deal', () => {
    const rows = [
      candidate({ id: 'z', contact_id: 'yusuf', property_title: 'Lotus' }),
      candidate({ id: 'd19', property_unit_no: '19' }),
      candidate({ id: 'd20', property_unit_no: '20' }),
      candidate({ id: 'g', deal_group_id: 'g1', property_unit_no: '21' }),
    ];
    const picked = bundleCandidates(rows, anchor);
    expect(picked.map((r) => r.id)).toEqual(['d20', 'z']);
    expect(sameBuyerIds(picked, anchor)).toEqual(['d20']);
  });

  it('labels, names and limits exactly as the web does', () => {
    expect(bundleCandidateLabel(candidate({ property_unit_no: '19' }))).toBe(
      'Property No. 19'
    );
    expect(defaultBundleName('Sidharth')).toBe('Sidharth — linked purchases');
    expect(defaultBundleName(null)).toBe('Linked purchases');
    expect(bundleBlocker('', 2)).toBe('Give the bundle a name.');
    expect(bundleBlocker('Sidharth', 1)).toMatch(/at least one more/);
    expect(bundleBlocker('Sidharth', BUNDLE_MAX_DEALS + 1)).toMatch(
      /at most 20/
    );
    expect(bundleBlocker('Sidharth', 2)).toBeNull();
  });
});
