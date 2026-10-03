export { formatInrCompact } from '@/lib/format/currency';

export function parseAmount(raw: string): number {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/[₹,\s]/g, '');
  if (!text) return 0;
  const match = text.match(
    /^(\d+(?:\.\d+)?)(cr|crore|crores|l|lakh|lakhs|lac|k)?$/
  );
  if (!match) return Number(text) || 0;
  const value = Number(match[1]);
  switch (match[2]) {
    case 'cr':
    case 'crore':
    case 'crores':
      return value * 10_000_000;
    case 'l':
    case 'lakh':
    case 'lakhs':
    case 'lac':
      return value * 100_000;
    case 'k':
      return value * 1_000;
    default:
      return value;
  }
}
