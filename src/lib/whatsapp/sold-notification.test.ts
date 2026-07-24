import { describe, it, expect } from 'vitest';
import {
  buildSoldNotificationBody,
  buildSoldPriceReply,
  dedupeAudience,
  SOLD_PRICE_BUTTON_PREFIX,
  SOLD_SIMILAR_BUTTON_PREFIX,
} from './sold-notification';

describe('buildSoldNotificationBody', () => {
  it('names the property and says it is no longer available', () => {
    const body = buildSoldNotificationBody('3 BHK Villa in Whitefield');
    expect(body).toContain('*3 BHK Villa in Whitefield*');
    expect(body).toContain('no longer available');
    expect(body).toContain('sold');
  });
});

describe('buildSoldPriceReply', () => {
  it('reveals the sold price when recorded', () => {
    const reply = buildSoldPriceReply('Athni Tower BTM', 125000000);
    expect(reply).toContain('*Athni Tower BTM*');
    expect(reply).toContain('₹12.50 Cr');
  });

  it('says the price is hidden when no sold price was entered', () => {
    for (const price of [null, undefined, 0]) {
      const reply = buildSoldPriceReply('Athni Tower BTM', price);
      expect(reply).toContain('price is hidden');
      expect(reply).not.toContain('₹');
    }
  });

  it('formats lakhs-range prices', () => {
    expect(buildSoldPriceReply('Plot', 8500000)).toContain('₹85 Lakhs');
  });
});

describe('dedupeAudience', () => {
  it('unions sources, dedupes, and drops the owner contact', () => {
    const audience = dedupeAudience(
      [
        ['a', 'b'],
        ['b', 'c', 'owner'],
        ['c', 'd'],
      ],
      'owner'
    );
    expect(audience).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles empty sources and null owner', () => {
    expect(dedupeAudience([[], []], null)).toEqual([]);
    expect(dedupeAudience([['a']], null)).toEqual(['a']);
  });
});

describe('button id prefixes', () => {
  it('compose ids under the 256-char Meta limit for uuids', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(`${SOLD_PRICE_BUTTON_PREFIX}${uuid}`.length).toBeLessThan(256);
    expect(`${SOLD_SIMILAR_BUTTON_PREFIX}${uuid}`.length).toBeLessThan(256);
  });
});
