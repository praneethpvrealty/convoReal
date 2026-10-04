import { formatInrCompact } from '@/lib/format/currency';

const LAKH = 100_000;

export function formatAdMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100;
  if (currency === 'INR' && Math.abs(rounded) >= LAKH) {
    return formatInrCompact(rounded);
  }
  const digits = Number.isInteger(rounded) ? 0 : 2;
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(rounded);
  } catch {
    return `${currency} ${rounded.toLocaleString('en-US')}`;
  }
}
