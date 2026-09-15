import { describe, expect, it } from 'vitest';

import { amountInWordsIndian, numberInWordsIndian } from './words';

describe('numberInWordsIndian', () => {
  // [INV-004] The reference invoice's total.
  it('groups in lakh, not in hundred-thousand', () => {
    expect(numberInWordsIndian(567000)).toBe('Five Lakh Sixty Seven Thousand');
  });

  it('groups in crore, not in million', () => {
    expect(numberInWordsIndian(162000000)).toBe('Sixteen Crore Twenty Lakh');
  });

  it('handles the two-digit irregulars', () => {
    expect(numberInWordsIndian(11)).toBe('Eleven');
    expect(numberInWordsIndian(19)).toBe('Nineteen');
    expect(numberInWordsIndian(20)).toBe('Twenty');
    expect(numberInWordsIndian(21)).toBe('Twenty One');
  });

  it('handles hundreds and the gaps between groups', () => {
    expect(numberInWordsIndian(100)).toBe('One Hundred');
    expect(numberInWordsIndian(1005)).toBe('One Thousand Five');
    expect(numberInWordsIndian(100000)).toBe('One Lakh');
    expect(numberInWordsIndian(10000000)).toBe('One Crore');
    expect(numberInWordsIndian(10100001)).toBe('One Crore One Lakh One');
  });

  it('extends past 999 crore in crore', () => {
    expect(numberInWordsIndian(10000000000)).toBe('One Thousand Crore');
  });

  it('is Zero for nothing', () => {
    expect(numberInWordsIndian(0)).toBe('Zero');
  });
});

describe('amountInWordsIndian', () => {
  // [INV-004] The line printed under the reference invoice's grand total.
  it('writes the reference invoice total', () => {
    expect(amountInWordsIndian(567000)).toBe(
      'Rupees Five Lakh Sixty Seven Thousand Only'
    );
  });

  it('names paise as their own unit', () => {
    expect(amountInWordsIndian(1234.5)).toBe(
      'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only'
    );
  });

  it('omits the paise clause when the amount is whole', () => {
    expect(amountInWordsIndian(1000)).toBe('Rupees One Thousand Only');
  });

  it('rounds to paise rather than dropping a fraction', () => {
    expect(amountInWordsIndian(0.005)).toBe('Rupees Zero and One Paise Only');
    expect(amountInWordsIndian(99.999)).toBe('Rupees One Hundred Only');
  });

  it('says Zero rather than nothing for an empty invoice', () => {
    expect(amountInWordsIndian(0)).toBe('Rupees Zero Only');
  });

  it('marks a negative amount rather than hiding the sign', () => {
    expect(amountInWordsIndian(-500)).toBe('Minus Rupees Five Hundred Only');
  });

  it('returns empty for a non-finite amount', () => {
    expect(amountInWordsIndian(Number.NaN)).toBe('');
  });
});
