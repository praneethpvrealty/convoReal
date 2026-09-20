import { describe, it, expect } from 'vitest';

import {
  interestChipLabel,
  projectOptions,
  withoutInterestedProperty,
  withoutLastInquiredProperty,
} from './contact-interest';

describe('[CTM-003] interest removal cache reconciliation', () => {
  it('removes the stale property and clears only the matching headline pointer', () => {
    expect(
      withoutInterestedProperty([{ id: 'p-1' }, { id: 'p-2' }], 'p-1')
    ).toEqual([{ id: 'p-2' }]);
    expect(
      withoutLastInquiredProperty(
        { id: 'c-1', last_inquired_property_id: 'p-1' },
        'p-1'
      )
    ).toEqual({ id: 'c-1', last_inquired_property_id: null });
    expect(
      withoutLastInquiredProperty(
        { id: 'c-1', last_inquired_property_id: 'p-2' },
        'p-1'
      )
    ).toEqual({ id: 'c-1', last_inquired_property_id: 'p-2' });
  });
});

describe('interestChipLabel', () => {
  it('passes short labels through untouched', () => {
    expect(
      interestChipLabel({ kind: 'property', value: 'x', label: 'HSR-101' })
    ).toBe('HSR-101');
  });

  it('ellipsises a long project name', () => {
    expect(
      interestChipLabel({
        kind: 'project',
        value: 'p',
        label: 'Prestige Lakeside Habitat',
      })
    ).toBe('Prestige Lakeside…');
  });

  it('does not leave a dangling space before the ellipsis', () => {
    expect(
      interestChipLabel(
        { kind: 'project', value: 'p', label: 'Sobha Dream Acres' },
        7
      )
    ).toBe('Sobha…');
  });
});

describe('projectOptions', () => {
  const rows = [
    { project: 'Prestige Lakeside' },
    { project: 'prestige lakeside' },
    { project: '  Prestige Lakeside  ' },
    { project: 'Sobha Dream Acres' },
    { project: null },
    { project: '   ' },
    {},
  ];

  it('dedupes case-insensitively and counts units', () => {
    expect(projectOptions(rows)).toEqual([
      { name: 'Prestige Lakeside', count: 3 },
      { name: 'Sobha Dream Acres', count: 1 },
    ]);
  });

  it('drops blank and missing project names', () => {
    expect(projectOptions([{ project: null }, { project: ' ' }, {}])).toEqual(
      []
    );
  });

  it('filters by a case-insensitive substring', () => {
    expect(projectOptions(rows, 'sobha')).toEqual([
      { name: 'Sobha Dream Acres', count: 1 },
    ]);
    expect(projectOptions(rows, 'lake')).toEqual([
      { name: 'Prestige Lakeside', count: 3 },
    ]);
    expect(projectOptions(rows, 'nothing')).toEqual([]);
  });

  it('orders by unit count, then name', () => {
    expect(
      projectOptions([
        { project: 'Zenith' },
        { project: 'Aspen' },
        { project: 'Brigade' },
        { project: 'Brigade' },
      ])
    ).toEqual([
      { name: 'Brigade', count: 2 },
      { name: 'Aspen', count: 1 },
      { name: 'Zenith', count: 1 },
    ]);
  });
});
