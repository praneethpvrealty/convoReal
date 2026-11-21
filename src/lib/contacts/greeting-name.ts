const EARNED_TITLES = new Set(['dr', 'prof']);

const COURTESY_TITLES = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mstr',
  'master',
  'shri',
  'sri',
  'smt',
  'kum',
  'sir',
  'madam',
  'mx',
]);

export function greetingName(name: string | null | undefined): string {
  const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  let title = '';
  while (i < tokens.length) {
    const bare = tokens[i].replace(/\./g, '').toLowerCase();
    if (EARNED_TITLES.has(bare)) title = tokens[i];
    else if (!COURTESY_TITLES.has(bare)) break;
    i++;
  }
  if (i >= tokens.length) return tokens[0] || '';
  return title ? `${title} ${tokens[i]}` : tokens[i];
}
