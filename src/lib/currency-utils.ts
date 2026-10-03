import {
  DollarSign,
  Euro,
  PoundSterling,
  IndianRupee,
  Coins,
} from 'lucide-react';

export function getCurrencyIcon(currency: string) {
  switch (currency) {
    case 'INR':
      return IndianRupee;
    case 'USD':
      return DollarSign;
    case 'EUR':
      return Euro;
    case 'GBP':
      return PoundSterling;
    default:
      return Coins;
  }
}

export {
  CURRENCY_SYMBOLS,
  equivalentPriceLabel,
  formatCurrency,
  formatCurrencyShort,
  formatInrCompact,
  formatInrPlain,
  priceInWords,
} from '@/lib/format/currency';
