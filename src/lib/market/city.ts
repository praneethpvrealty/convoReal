export const CITY_ALIASES: Record<string, string> = {
  bangalore: 'bengaluru',
  bengalooru: 'bengaluru',
  blr: 'bengaluru',
  'bangalore urban': 'bengaluru',
  'bengaluru urban': 'bengaluru',
  mysore: 'mysuru',
  mangalore: 'mangaluru',
  belgaum: 'belagavi',
  hubli: 'hubballi',
  tumkur: 'tumakuru',
  shimoga: 'shivamogga',
  gulbarga: 'kalaburagi',
  bellary: 'ballari',
  bijapur: 'vijayapura',
  gurgaon: 'gurugram',
  bombay: 'mumbai',
  madras: 'chennai',
  calcutta: 'kolkata',
  pondicherry: 'puducherry',
};

export function normalizeToken(raw: string | null | undefined): string | null {
  const t = (raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

export function canonicalCity(raw: string | null | undefined): string | null {
  const token = normalizeToken(raw);
  if (!token) return null;
  return CITY_ALIASES[token] ?? token;
}
