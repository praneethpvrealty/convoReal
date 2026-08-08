import { describe, it, expect } from 'vitest';
import { carriesPriceFactSignal, sanitizePriceFacts } from './chat-learning';

describe('carriesPriceFactSignal', () => {
  it('accepts the message that started this feature', () => {
    expect(
      carriesPriceFactSignal(
        "Hey Anju , seller's final price is 10.5k per sqft."
      )
    ).toBe(true);
  });

  it('accepts the other shapes agents actually type', () => {
    for (const text of [
      'Owner has finalised at 4.2 Cr',
      'Best price is 9800 psf',
      'He agreed to 3.75 crore',
      'Seller will not go below 85 lakhs',
      'They can come down to 1.1 Cr',
      'Slightly negotiable — around 10000 per sq ft',
    ]) {
      expect(carriesPriceFactSignal(text), text).toBe(true);
    }
  });

  it('rejects ordinary replies without spending a model call', () => {
    for (const text of [
      'Ok thanks',
      'Sure, let me check and revert',
      "I'll call you at 4",
      'Sharing the layout now',
      'Sending you the location pin',
      '',
      null,
      undefined,
    ]) {
      expect(carriesPriceFactSignal(text), String(text)).toBe(false);
    }
  });

  it('rejects finality with no figure — "the price is final" states no number', () => {
    expect(carriesPriceFactSignal('The price is final, no negotiation')).toBe(
      false
    );
  });

  it('rejects a bare price restatement — that is the listing, not a revision', () => {
    expect(carriesPriceFactSignal('The price is 4.41 Cr')).toBe(false);
    expect(carriesPriceFactSignal('It is priced at 42000000')).toBe(false);
  });
});

describe('sanitizePriceFacts', () => {
  it('keeps a well-formed fact', () => {
    expect(
      sanitizePriceFacts([
        { field: 'seller_final_price_per_sqft', value: 10500 },
      ])
    ).toEqual([{ field: 'seller_final_price_per_sqft', value: 10500 }]);
  });

  it('drops a field that is not suggestable', () => {
    expect(sanitizePriceFacts([{ field: 'price', value: 42000000 }])).toEqual(
      []
    );
    expect(sanitizePriceFacts([{ field: 'is_published', value: 1 }])).toEqual(
      []
    );
  });

  it('drops a rate the model failed to scale — 10.5 is not a per-sqft rate', () => {
    expect(
      sanitizePriceFacts([
        { field: 'seller_final_price_per_sqft', value: 10.5 },
      ])
    ).toEqual([]);
  });

  it('drops a total below what any listing costs', () => {
    expect(
      sanitizePriceFacts([{ field: 'seller_final_price', value: 4.2 }])
    ).toEqual([]);
  });

  it('keeps only the first fact per field', () => {
    expect(
      sanitizePriceFacts([
        { field: 'seller_final_price', value: 42000000 },
        { field: 'seller_final_price', value: 41000000 },
      ])
    ).toEqual([{ field: 'seller_final_price', value: 42000000 }]);
  });

  it('rounds and coerces a numeric string', () => {
    expect(
      sanitizePriceFacts([
        { field: 'seller_final_price_per_sqft', value: '10500.4' },
      ])
    ).toEqual([{ field: 'seller_final_price_per_sqft', value: 10500 }]);
  });

  it('survives whatever the model returns instead of a list', () => {
    expect(sanitizePriceFacts(undefined)).toEqual([]);
    expect(sanitizePriceFacts(null)).toEqual([]);
    expect(sanitizePriceFacts('nope')).toEqual([]);
    expect(
      sanitizePriceFacts([null, 3, { field: 'seller_final_price' }])
    ).toEqual([]);
  });
});
