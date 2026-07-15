import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  buildInventoryUpdateTemplatePayload,
  buildInventoryUpdateParams,
  sanitizeTemplateParam,
  INVENTORY_UPDATE_TEMPLATE_NAME,
} from './inventory-update-template';
import { validateTemplatePayload } from './template-validators';

function prop(overrides: Partial<Property>): Property {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'a1',
    user_id: 'u1',
    title: 'Untitled',
    price: 0,
    location: 'Bangalore',
    type: 'Residential Land/ Plot',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    ...overrides,
  } as Property;
}

describe('buildInventoryUpdateTemplatePayload', () => {
  it('produces a payload that passes the same validator the submit API runs', () => {
    const payload = buildInventoryUpdateTemplatePayload('https://www.convoreal.com');
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(INVENTORY_UPDATE_TEMPLATE_NAME);
    expect(payload.category).toBe('Marketing');
  });

  it('puts quick replies before the URL button and carries a dynamic tracked suffix', () => {
    const payload = buildInventoryUpdateTemplatePayload('https://www.convoreal.com/');
    const types = (payload.buttons ?? []).map((b) => b.type);
    expect(types).toEqual(['QUICK_REPLY', 'QUICK_REPLY', 'URL']);
    const urlBtn = payload.buttons?.find((b) => b.type === 'URL');
    expect(urlBtn && 'url' in urlBtn ? urlBtn.url : '').toBe('https://www.convoreal.com/{{1}}');
  });

  it('keeps the worst-case rendered body inside the 1024-char Meta cap', () => {
    const payload = buildInventoryUpdateTemplatePayload('https://www.convoreal.com');
    const skeleton = payload.body_text.replace(/\{\{\d\}\}/g, '');
    // name (~30) + three 200-char category lines
    expect(skeleton.length + 30 + 3 * 200).toBeLessThanOrEqual(1024);
  });
});

describe('sanitizeTemplateParam', () => {
  it('strips newlines/tabs and collapses runs of spaces (Meta param rules)', () => {
    expect(sanitizeTemplateParam('a\nb\tc    d')).toBe('a b c d');
  });

  it('truncates over-long values with an ellipsis', () => {
    const out = sanitizeTemplateParam('x'.repeat(500));
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildInventoryUpdateParams', () => {
  it('builds one single-line snapshot per section with counts, prices and overflow', () => {
    const [res, com, farm] = buildInventoryUpdateParams([
      prop({ title: 'Golden City', type: 'Residential Land/ Plot', price: 4440000 }),
      prop({ title: 'Sumadhura Eden Garden', type: 'Flat/ Apartment', price: 17000000, bedrooms: 2.5 }),
      prop({ title: 'Villa Third', type: 'Villa', price: 60000000 }),
      prop({ title: 'Prestige Office', type: 'Commercial Office Space', listing_type: 'Rent', rent_per_month: 630000 }),
      prop({ title: 'Green Acres', type: 'Agricultural Land', price: 52000000 }),
    ]);
    expect(res).toBe(
      '3 options — Golden City (₹44.40 Lakhs), Sumadhura Eden Garden (2.5 BHK · ₹1.70 Cr) +1 more',
    );
    expect(com).toBe('1 option — Prestige Office (₹6.30 Lakhs/mo rent)');
    expect(farm).toBe('1 option — Green Acres (₹5.20 Cr)');
    for (const line of [res, com, farm]) {
      expect(line).not.toMatch(/[\n\t]| {4,}/);
    }
  });

  it('includes ROI for investment listings and never returns an empty param', () => {
    const [res, com, farm] = buildInventoryUpdateParams([
      prop({ title: 'Oval Reef Warehouse', type: 'Warehouse/ Godown', price: 90000000, roi: 6 }),
    ]);
    expect(com).toContain('ROI 6%');
    // Meta rejects empty body params — empty sections get teaser copy.
    expect(res).toBe('fresh stock arriving — ask me for a preview');
    expect(farm).toBe('fresh stock arriving — ask me for a preview');
  });
});
