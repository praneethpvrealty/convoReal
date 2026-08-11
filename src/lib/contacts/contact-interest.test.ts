import { describe, expect, it } from 'vitest';

import { projectOptions } from './contact-interest';

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
