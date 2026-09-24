import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractReferral,
  processCtwaReferral,
  formatReferrerLabel,
  deriveContactUpgrade,
  CTWA_SOURCE,
  type WhatsAppReferral,
} from '@/lib/whatsapp/ctwa-attribution';

describe('extractReferral', () => {
  it('normalizes a full ad referral', () => {
    const raw: WhatsAppReferral = {
      source_type: 'ad',
      source_id: '120210000000000',
      source_url: 'https://fb.com/x',
      headline: '3 BHK in HSR Layout',
      body: 'Premium flat',
      media_type: 'image',
      image_url: 'https://img/x.jpg',
      ctwa_clid: 'abc123',
    };
    expect(extractReferral(raw)).toEqual({
      sourceType: 'ad',
      sourceId: '120210000000000',
      sourceUrl: 'https://fb.com/x',
      headline: '3 BHK in HSR Layout',
      body: 'Premium flat',
      mediaType: 'image',
      imageUrl: 'https://img/x.jpg',
      videoUrl: null,
      ctwaClid: 'abc123',
    });
  });

  it('accepts a referral with only a click id (no source_id)', () => {
    const r = extractReferral({ ctwa_clid: 'clk' });
    expect(r?.ctwaClid).toBe('clk');
    expect(r?.sourceId).toBeNull();
  });

  it('returns null when neither source_id nor ctwa_clid is present', () => {
    expect(extractReferral({ headline: 'orphan headline' })).toBeNull();
  });

  it('returns null for undefined/null', () => {
    expect(extractReferral(undefined)).toBeNull();
    expect(extractReferral(null)).toBeNull();
  });

  it('treats whitespace-only fields as absent', () => {
    expect(extractReferral({ source_id: '   ', ctwa_clid: '  ' })).toBeNull();
    const r = extractReferral({ source_id: '  id  ', headline: '   ' });
    expect(r?.sourceId).toBe('id');
    expect(r?.headline).toBeNull();
  });
});

describe('formatReferrerLabel', () => {
  const base = extractReferral({ source_id: 'x' })!;
  it('includes the headline when present', () => {
    expect(formatReferrerLabel({ ...base, headline: 'Cozy 2BHK' })).toBe('Meta Ad — "Cozy 2BHK"');
  });
  it('falls back to a plain label without a headline', () => {
    expect(formatReferrerLabel({ ...base, headline: null })).toBe('Meta Ad');
  });
});

describe('deriveContactUpgrade', () => {
  const ref = extractReferral({ source_id: 'x', headline: 'Villa Plot' })!;

  it('stamps all three fields on a blank contact', () => {
    expect(deriveContactUpgrade({}, ref)).toEqual({
      source: CTWA_SOURCE,
      referrer: 'Meta Ad — "Villa Plot"',
      classification: 'Buyer',
    });
  });

  it('never overwrites an existing source or referrer', () => {
    const out = deriveContactUpgrade(
      { source: 'Website Showcase', referrer: 'Existing ref', classification: 'Others' },
      ref,
    );
    expect(out.source).toBeUndefined();
    expect(out.referrer).toBeUndefined();
    expect(out.classification).toBe('Buyer'); // 'Others' still upgrades
  });

  it('does not touch a meaningful classification', () => {
    const out = deriveContactUpgrade({ classification: 'Seller' }, ref);
    expect(out.classification).toBeUndefined();
  });

  it('promotes only the generic Others classification', () => {
    expect(deriveContactUpgrade({ classification: 'Others' }, ref).classification).toBe('Buyer');
    expect(deriveContactUpgrade({ classification: null }, ref).classification).toBe('Buyer');
    expect(deriveContactUpgrade({ classification: 'Buyer' }, ref).classification).toBeUndefined();
  });
});

describe('processCtwaReferral', () => {
  function fakeAdmin() {
    const contactUpdates: Record<string, unknown>[] = [];
    const chain = (table: string) => {
      const builder = {
        upsert: () => Promise.resolve({ error: null }),
        update: (payload: Record<string, unknown>) => {
          if (table === 'contacts') contactUpdates.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: { property_id: 'prop-1' }, error: null }),
      };
      return builder;
    };
    return {
      admin: { from: chain } as unknown as SupabaseClient,
      contactUpdates,
    };
  }

  const args = {
    accountId: 'acc-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    messageId: 'wamid-1',
    referral: { source_id: 'ad-1', headline: 'Villa Plot' },
    contact: { source: 'WhatsApp', referrer: 'Existing', classification: 'Buyer' },
  };

  it('[CTM-009] links the ad listing to an existing contact without moving them to Needs Review', async () => {
    const { admin, contactUpdates } = fakeAdmin();
    const result = await processCtwaReferral({ ...args, admin, contactWasCreated: false });
    expect(result.linkedPropertyId).toBe('prop-1');
    const link = contactUpdates.find((u) => u.last_inquired_property_id === 'prop-1');
    expect(link).toBeDefined();
    expect(link).not.toHaveProperty('status');
  });

  it('[CTM-009] sends a contact the ad click created to Needs Review', async () => {
    const { admin, contactUpdates } = fakeAdmin();
    await processCtwaReferral({ ...args, admin, contactWasCreated: true });
    const link = contactUpdates.find((u) => u.last_inquired_property_id === 'prop-1');
    expect(link?.status).toBe('pending_review');
  });
});
