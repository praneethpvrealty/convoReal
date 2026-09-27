import { describe, it, expect } from 'vitest';
import {
  buildSoldNotificationBody,
  buildPropertyStatusNotificationBody,
  buildSoldPriceReply,
  dedupeAudience,
  usableStatusUpdateTemplate,
  shouldNotifyBuyersOfPropertyStatus,
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

describe('property status notifications', () => {
  it.each([
    ['Available', 'available again', false],
    ['Under Contract', 'under contract', false],
    ['Sold', 'sold', true],
    ['Archived', 'archived', false],
    ['Off Market', 'off the market', false],
  ] as const)('uses accurate copy for %s', (status, phrase, mentionsSold) => {
    const body = buildPropertyStatusNotificationBody('JP Nagar Plot', status);
    expect(body).toContain(`*New status:* ${status}`);
    expect(body.toLowerCase()).toContain(phrase);
    expect(body.toLowerCase().includes('sold')).toBe(mentionsSold);
  });

  it('notifies only on buyer-visible status transitions', () => {
    expect(
      shouldNotifyBuyersOfPropertyStatus('Available', 'Under Contract')
    ).toBe(true);
    expect(
      shouldNotifyBuyersOfPropertyStatus('Under Contract', 'Available')
    ).toBe(true);
    expect(shouldNotifyBuyersOfPropertyStatus('Available', 'Available')).toBe(
      false
    );
    expect(
      shouldNotifyBuyersOfPropertyStatus('Available', 'Pending Review')
    ).toBe(false);
    expect(shouldNotifyBuyersOfPropertyStatus('Available', 'Rejected')).toBe(
      false
    );
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

  it('[PRP-014] leaves out contacts who closed their enquiry on the listing', () => {
    expect(
      dedupeAudience(
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
        null,
        new Set(['b'])
      )
    ).toEqual(['a', 'c']);
  });

  it('[PRP-014] builds the audience without anyone who rejected the listing', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('./sold-notification.ts', import.meta.url),
      'utf8'
    );
    expect(source).toMatch(
      /\.from\('listing_feedback'\)[\s\S]{0,200}\.eq\('verdict', 'rejected'\)/
    );
    expect(source).toContain(
      'property.owner_contact_id as string | null,\n    closedEnquiries'
    );
  });

  it('[PRP-014] sends nothing when any audience source cannot be read', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('./sold-notification.ts', import.meta.url),
      'utf8'
    );
    expect(source).toMatch(
      /interestedRes\.error \?\?\s*inquiriesRes\.error \?\?\s*sharesRes\.error \?\?\s*rejectedRes\.error/
    );
  });

  it('[PRP-014] re-checks the listing before every send and stops once it has moved on', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('./sold-notification.ts', import.meta.url),
      'utf8'
    );
    const loop = source.indexOf('for (const contactId of audience) {');
    const recheck = source.indexOf(
      'await listingStillHasStatus(db, accountId, propertyId, status)'
    );
    const firstSend = source.indexOf('sendWhatsAppMessageAndPersist(', loop);
    expect(loop).toBeGreaterThan(-1);
    expect(recheck).toBeGreaterThan(loop);
    expect(recheck).toBeLessThan(firstSend);
  });

  it('[PRP-014] re-checks each contact for a closed enquiry right before their send', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('./sold-notification.ts', import.meta.url),
      'utf8'
    );
    const loop = source.indexOf('for (const contactId of audience) {');
    const closed = source.indexOf(
      'if (await closedEnquiryOnListing(db, accountId, propertyId, contactId)) {'
    );
    const firstSend = source.indexOf('sendWhatsAppMessageAndPersist(', loop);
    expect(closed).toBeGreaterThan(loop);
    expect(closed).toBeLessThan(firstSend);
    expect(source).toMatch(/return !!error \|\| !!data;/);
  });

  it('[PRP-014] stops an available-again run while a deal still holds the listing', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('./sold-notification.ts', import.meta.url),
      'utf8'
    );
    expect(source).toMatch(
      /status === 'Available' &&\s*\(await dealsStillHoldListing\(db, accountId, propertyId, stageIds\)\)/
    );
    expect(source).toContain('!stageIds ||');
    expect(source).toContain('.limit(1);');
    expect(source).not.toContain(
      "select('status, stage:pipeline_stages(name)')"
    );
    expect(source).toContain('if (error) return true;');
  });

  it('uses any approved Utility variant of the status template, not only the newest row', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('./sold-notification.ts', import.meta.url),
      'utf8'
    );
    expect(source).toMatch(
      /\.find\(\s*\(row\) => usableStatusUpdateTemplate\(row\) !== null\s*\)/
    );
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

describe('usableStatusUpdateTemplate', () => {
  it('[PRP-014] sends a status update only on an approved Utility template, never a Marketing one', () => {
    expect(
      usableStatusUpdateTemplate({ status: 'APPROVED', category: 'UTILITY' })
    ).not.toBeNull();
    expect(
      usableStatusUpdateTemplate({ status: 'APPROVED', category: 'Utility' })
    ).not.toBeNull();
    expect(
      usableStatusUpdateTemplate({ status: 'APPROVED', category: 'MARKETING' })
    ).toBeNull();
    expect(
      usableStatusUpdateTemplate({ status: 'PENDING', category: 'UTILITY' })
    ).toBeNull();
  });
});
