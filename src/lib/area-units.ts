// ============================================================
// Area-unit conversion. A leaf module on purpose: the matching
// engine needs these, `@shared/lib/matching` is how the mobile app
// reads that engine's types, and the intake derivations these used
// to live beside import the Gemini draft type — which reaches
// `supabase/admin` and pulls a server-only module (and a root-only
// dependency) into the mobile typecheck program.
// ============================================================

const SQFT_PER_UNIT: Record<string, number> = {
  sqft: 1,
  sqyd: 9,
  sqmtr: 10.7639,
  acre: 43_560,
  gunta: 1_089,
  cent: 435.6,
  ground: 2_400,
};

/** Maps any spelling of an area unit onto a `SQFT_PER_UNIT` key. */
export function canonicalAreaUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
  if (key.startsWith('sqf') || key === 'sf') return 'sqft';
  if (key.startsWith('sqy')) return 'sqyd';
  if (key.startsWith('sqm')) return 'sqmtr';
  if (key.startsWith('acre')) return 'acre';
  if (key.startsWith('gunta') || key.startsWith('guntha')) return 'gunta';
  if (key.startsWith('cent')) return 'cent';
  if (key.startsWith('ground')) return 'ground';
  return null;
}

export function toSquareFeet(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (!value || value <= 0 || !Number.isFinite(value)) return null;
  const factor = SQFT_PER_UNIT[canonicalAreaUnit(unit) ?? 'sqft'];
  return factor ? value * factor : null;
}
