export function ilikeTerm(raw: string): string | null {
  const cleaned = raw
    .replace(/[(),"\\]/g, ' ')
    .replace(/[*%]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function ilikeAcross(columns: string[], term: string): string {
  return columns.map((col) => `${col}.ilike."%${term}%"`).join(',');
}
