import { describe, expect, it } from 'vitest';

import { contactTextSearchFilters } from './search-filter';

function topLevelBranches(expression: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of expression) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === '(' || ch === '{')) depth += 1;
    if (!quoted && (ch === ')' || ch === '}')) depth -= 1;
    if (!quoted && depth === 0 && ch === ',') {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

describe('[UIX-009] contactTextSearchFilters', () => {
  it('keeps a comma or parenthesis inside the search term from adding branches', () => {
    const expression = contactTextSearchFilters('Rao, K (Builder)').join(',');
    const branches = topLevelBranches(expression);
    expect(branches).toHaveLength(10);
    for (const branch of branches) {
      expect(branch).toMatch(/^[a-z_]+\.(ilike|cs)\./);
    }
    expect(expression).toContain('name.ilike."%Rao K Builder%"');
  });

  it('quotes every ilike value', () => {
    for (const branch of topLevelBranches(
      contactTextSearchFilters('villa').join(',')
    )) {
      if (branch.includes('.ilike.'))
        expect(branch).toMatch(/\.ilike\."%.*%"$/);
    }
  });

  it('adds a digits-only phone branch for a formatted number', () => {
    expect(contactTextSearchFilters('+91 97006-06010')).toContain(
      'phone.ilike."%919700606010%"'
    );
  });

  it('drops quotes so they cannot close the literal', () => {
    const expression = contactTextSearchFilters('the "Grand"').join(',');
    expect(expression).toContain('name.ilike."%the Grand%"');
    expect(expression).toContain('secondary_phones.cs.{"the Grand"}');
  });

  it('returns no filters for a term that is only punctuation', () => {
    expect(contactTextSearchFilters('(),')).toEqual([]);
  });
});
