// Coerces a value parsed out of a free-form WhatsApp listing message
// into a number. Strings are stripped to digits and dots before
// parsing — lenient by design so "₹1.5 Cr" style noise around a clean
// value still yields a number. Callers pass the result through `|| 0`
// or store it directly, so a wrong parse silently corrupts listing data.

export function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^\d.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}
