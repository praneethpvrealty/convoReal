import { describe, it, expect } from 'vitest';
import type { Contact, Property } from '@/types';
import {
  buildInventoryUpdateTemplatePayload,
  buildInventoryUpdateParams,
  buildPropertySelectionUpdateParams,
  sanitizeTemplateParam,
  PROPERTY_SELECTION_UPDATE_TEMPLATE_NAME,
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
    const payload = buildInventoryUpdateTemplatePayload(
      'https://www.convoreal.com'
    );
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(PROPERTY_SELECTION_UPDATE_TEMPLATE_NAME);
    expect(payload.category).toBe('Marketing');
  });

  it('puts quick replies before the URL button and carries a dynamic tracked suffix', () => {
    const payload = buildInventoryUpdateTemplatePayload(
      'https://www.convoreal.com/'
    );
    const types = (payload.buttons ?? []).map((b) => b.type);
    expect(types).toEqual(['QUICK_REPLY', 'QUICK_REPLY', 'URL']);
    const urlBtn = payload.buttons?.find((b) => b.type === 'URL');
    expect(urlBtn && 'url' in urlBtn ? urlBtn.url : '').toBe(
      'https://www.convoreal.com/{{1}}'
    );
  });

  it('keeps the worst-case rendered body inside the 1024-char Meta cap', () => {
    const payload = buildInventoryUpdateTemplatePayload(
      'https://www.convoreal.com'
    );
    const skeleton = payload.body_text.replace(/\{\{\d\}\}/g, '');
    // name (~30) + one 600-char scope-aware selection line
    expect(skeleton.length + 30 + 600).toBeLessThanOrEqual(1024);
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
      prop({
        title: 'Golden City',
        type: 'Residential Land/ Plot',
        price: 4440000,
      }),
      prop({
        title: 'Sumadhura Eden Garden',
        type: 'Flat/ Apartment',
        price: 17000000,
        bedrooms: 2.5,
      }),
      prop({ title: 'Villa Third', type: 'Villa', price: 60000000 }),
      prop({
        title: 'Prestige Office',
        type: 'Commercial Office Space',
        listing_type: 'Rent',
        rent_per_month: 630000,
      }),
      prop({
        title: 'Green Acres',
        type: 'Agricultural Land',
        price: 52000000,
      }),
    ]);
    expect(res).toBe(
      '3 options — Golden City (₹44.40 Lakhs), Sumadhura Eden Garden (2.5 BHK · ₹1.70 Cr) +1 more'
    );
    expect(com).toBe('1 option — Prestige Office (₹6.30 Lakhs/mo rent)');
    expect(farm).toBe('1 option — Green Acres (₹5.20 Cr)');
    for (const line of [res, com, farm]) {
      expect(line).not.toMatch(/[\n\t]| {4,}/);
    }
  });

  it('includes ROI for investment listings and never returns an empty param', () => {
    const [res, com, farm] = buildInventoryUpdateParams([
      prop({
        title: 'Oval Reef Warehouse',
        type: 'Warehouse/ Godown',
        price: 90000000,
        roi: 6,
      }),
    ]);
    expect(com).toContain('ROI 6%');
    // Meta rejects empty body params — empty sections get teaser copy.
    expect(res).toBe('no published options right now');
    expect(farm).toBe('no published options right now');
  });

  it('leads with true contact matches and distinguishes other stock', () => {
    const buyer = {
      id: 'c1',
      user_id: 'u1',
      phone: '+919999999999',
      property_interests: ['Villa'],
      areas_of_interest: ['HBR Layout'],
      requirement_active: true,
    } as Contact;
    const [res] = buildInventoryUpdateParams(
      [
        prop({ title: 'Whitefield Plot', sublocality: 'Whitefield' }),
        prop({ title: 'HBR Villa', type: 'Villa', sublocality: 'HBR Layout' }),
      ],
      buyer
    );
    expect(res).toContain('1 match from 2 available — HBR Villa');
    expect(res).toContain('1 other option');
  });
});

describe('buildPropertySelectionUpdateParams', () => {
  it('names only the categories present in the selected scope', () => {
    const [selection] = buildPropertySelectionUpdateParams([
      prop({
        title: 'Thippasandra Main Road Building',
        type: 'Commercial Building',
        price: 150000000,
        roi: 6.4,
      }),
      prop({
        title: 'Commercial Corner Plot',
        type: 'Commercial Plot',
        price: 140000000,
        roi: 3,
      }),
    ]);

    expect(selection).toContain('Commercial: 2 options');
    expect(selection).toContain('Thippasandra Main Road Building');
    expect(selection).not.toContain('Residential');
    expect(selection).not.toContain('Farm & land');
  });

  it('includes each non-empty category for a mixed hand-picked selection', () => {
    const [selection] = buildPropertySelectionUpdateParams([
      prop({ title: 'Golden City', type: 'Residential Land/ Plot' }),
      prop({ title: 'Prestige Office', type: 'Commercial Office Space' }),
    ]);

    expect(selection).toContain('Residential:');
    expect(selection).toContain('Commercial:');
    expect(selection).not.toContain('Farm & land');
  });
});

describe('[PRP-064] property_selection_update readability', () => {
  const buyer = {
    id: 'c1',
    user_id: 'u1',
    phone: '+919999999999',
    property_interests: ['Commercial Building'],
    areas_of_interest: ['Marathahalli'],
    requirement_active: true,
  } as Contact;

  it('files an untyped listing under Other, never Farm & land, and a legacy commercial type under Commercial', () => {
    const [selection] = buildPropertySelectionUpdateParams([
      prop({ title: 'Mixed-use Building', type: 'Others', price: 95000000 }),
      prop({
        title: 'Whitefield Commercial',
        type: 'Commercial/ Industrial',
        price: 120000000,
      }),
    ]);
    expect(selection).toContain('Other: 1 option — Mixed-use Building');
    expect(selection).toContain('Commercial: 1 option — Whitefield Commercial');
    expect(selection).not.toContain('Farm & land');
  });

  it('names only the categories holding a match when the contact has one', () => {
    const [selection] = buildPropertySelectionUpdateParams(
      [
        prop({ title: 'Koramangala House', type: 'Residential House' }),
        prop({
          title: 'Munnekolal Building',
          type: 'Commercial Building',
          sublocality: 'Marathahalli',
        }),
        prop({ title: 'Farm Plot', type: 'Agricultural Land' }),
      ],
      buyer
    );
    expect(selection).toMatch(/^Commercial: 1 match from 1 available/);
    expect(selection).not.toContain('Residential');
    expect(selection).not.toContain('Farm & land');
  });

  it('drops whole listings instead of cutting a word when the text is long', () => {
    const long = (n: number, type: string) =>
      prop({
        title: `Residential Building with Thirteen Fully Furnished Units and Rooftop Garden in HSR Layout Sector ${n}`,
        type,
        price: 44000000,
        roi: 8.73,
      });
    const [selection] = buildPropertySelectionUpdateParams([
      long(1, 'Residential House'),
      long(2, 'Residential House'),
      long(3, 'Commercial Building'),
      long(4, 'Commercial Building'),
      long(5, 'Agricultural Land'),
    ]);
    expect(selection.length).toBeLessThanOrEqual(600);
    expect(selection).not.toContain('…');
    for (const section of selection.split(' • ')) {
      expect(section).toMatch(/\(₹4\.40 Cr · ROI 8\.73%\)( \+\d+ more)?$/);
    }
  });

  it('cuts an over-long parameter at a word boundary', () => {
    expect(
      sanitizeTemplateParam('Commercial Building for Sale in Munnekolal', 30)
    ).toBe('Commercial Building for Sale…');
  });
});

describe('[PRP-065] property_selection_update for a brief nothing matches', () => {
  it('names only the category the buyer asked for, nearest price first', () => {
    const contact = {
      id: 'c1',
      user_id: 'u1',
      phone: '+919999999999',
      name: 'Dr Subbaiha',
      requirement_active: true,
      pref_property_categories: ['commercial'],
      pref_budget_min: 100_000_000,
      pref_budget_max: 150_000_000,
      pref_areas: ['Indiranagar'],
      strict_area_match: true,
    } as unknown as Contact;
    const [selection] = buildPropertySelectionUpdateParams(
      [
        prop({
          title: 'IT Park in Domlur',
          type: 'Commercial Building',
          price: 3_800_000_000,
          location: 'Domlur',
          is_starred: true,
        }),
        prop({
          title: 'Flat in Whitefield',
          type: 'Flat/ Apartment',
          price: 21_500_000,
          location: 'Whitefield',
        }),
        prop({
          title: 'Rented Building in Kundalahalli',
          type: 'Commercial Building',
          price: 200_000_000,
          location: 'Kundalahalli',
        }),
      ],
      contact
    );
    expect(selection).toMatch(/^Commercial: 2 available, closest options/);
    expect(selection).not.toContain('Residential');
    expect(selection.indexOf('Rented Building')).toBeLessThan(
      selection.indexOf('IT Park')
    );
  });
});
