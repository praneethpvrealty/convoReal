import { describe, it, expect, vi } from 'vitest';
import { generateJsonFromParts } from '@/lib/ai/gemini';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  applyRecordUpdate,
  buildRecordPatch,
  formatRecordUnchangedReply,
  formatRecordUpdateFailureReply,
  formatRecordUpdateResult,
} from './record-edit';

vi.mock('@/lib/ai/gemini', () => ({ generateJsonFromParts: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

describe('buildRecordPatch', () => {
  const property = {
    id: 'p1',
    account_id: 'acc',
    title: 'Old title',
    price: 8200000,
    location: 'HSR Layout',
    bedrooms: 3,
    is_published: true,
  };

  it('keeps only fields the instruction actually changed', () => {
    const patch = buildRecordPatch('property', property, {
      title: 'New title',
      price: 8200000,
      location: 'HSR Layout',
    });
    expect(patch).toEqual({ title: 'New title' });
  });

  it('refuses to touch anything outside the whitelist', () => {
    const patch = buildRecordPatch('property', property, {
      title: 'New title',
      account_id: 'attacker-account',
      id: 'other-id',
      is_published: false,
    });
    expect(patch).toEqual({ title: 'New title' });
    expect(patch).not.toHaveProperty('account_id');
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('is_published');
  });

  it('coerces money and counts written as text', () => {
    const patch = buildRecordPatch('property', property, {
      price: '₹1,20,00,000',
      bedrooms: '4',
    });
    expect(patch).toEqual({ price: 12000000, bedrooms: 4 });
  });

  it('ignores a numeric field the model returned as junk', () => {
    expect(buildRecordPatch('property', property, { price: 'call for price' })).toEqual({});
  });

  it('trims strings and drops ones blanked to empty', () => {
    const patch = buildRecordPatch('property', property, {
      title: '  Spaced title  ',
      location: '   ',
    });
    expect(patch).toEqual({ title: 'Spaced title' });
  });

  it('allows an explicit null to clear a nullable field', () => {
    expect(buildRecordPatch('property', property, { price: null })).toEqual({ price: null });
  });

  it('returns nothing when the model echoed the record back', () => {
    expect(buildRecordPatch('property', property, property)).toEqual({});
  });

  it('scopes the whitelist per entity', () => {
    const contact = { name: 'Ravi', email: null, classification: 'Buyer', phone: '+919876543210' };
    const patch = buildRecordPatch('contact', contact, {
      name: 'Ravi Kumar',
      phone: '+910000000000',
      title: 'nonsense',
    });
    expect(patch).toEqual({ name: 'Ravi Kumar' });
  });

  it('survives a non-object model response', () => {
    expect(buildRecordPatch('property', property, null)).toEqual({});
    expect(buildRecordPatch('property', property, 'oops')).toEqual({});
  });

  it('stores a WhatsApp tenant update in the structured floor rent roll', () => {
    const floorTenancies = [
      {
        floor: 'Basement',
        tenant_name: 'Cloth showroom',
        monthly_rent: 100000,
        lock_in_months: 60,
        notes: '2 years remaining',
      },
      {
        floor: 'Ground Floor',
        tenant_name: 'ICICI Bank',
        monthly_rent: 400000,
        lock_in_months: 96,
        notes: '4 years completed',
      },
      {
        floor: '1st, 2nd and 3rd Floors',
        tenant_name: 'Ladies PG',
        monthly_rent: 400000,
        lock_in_months: 60,
      },
    ];

    const patch = buildRecordPatch(
      'property',
      { ...property, description: 'Existing description', floor_tenancies: [] },
      { description: 'Existing description', floor_tenancies: floorTenancies }
    );

    expect(patch).not.toHaveProperty('description');
    expect(patch.floor_tenancies).toEqual([
      expect.objectContaining({
        floor: 'Basement',
        tenant_name: 'Cloth showroom',
        monthly_rent: 100000,
        lock_in_months: 60,
        notes: '2 years remaining',
      }),
      expect.objectContaining({
        floor: 'Ground Floor',
        tenant_name: 'ICICI Bank',
        monthly_rent: 400000,
        lock_in_months: 96,
        notes: '4 years completed',
      }),
      expect.objectContaining({
        floor: '1st, 2nd and 3rd Floors',
        tenant_name: 'Ladies PG',
        monthly_rent: 400000,
        lock_in_months: 60,
      }),
    ]);
  });

  it('does not clear a valid rent roll when the model returns malformed rows', () => {
    const existing = [{ floor: 'Ground Floor', tenant_name: 'Bank', monthly_rent: 400000 }];
    expect(buildRecordPatch('property', { ...property, floor_tenancies: existing }, {
      floor_tenancies: ['not a tenancy row'],
    })).toEqual({});
  });

  it('formats structured tenant updates as readable WhatsApp lines', () => {
    expect(formatRecordUpdateResult({
      floor_tenancies: [
        {
          floor: 'Ground Floor',
          tenant_name: 'ICICI Bank',
          monthly_rent: 400000,
          lock_in_months: 96,
          notes: '4 years completed',
        },
      ],
    })).toEqual({
      floor_tenancies:
        '1 lease\n– Ground Floor · ICICI Bank · ₹4,00,000/month · 96-month lock-in · 4 years completed',
    });
  });

  it('explains that an unchanged listing is already up to date', () => {
    expect(formatRecordUnchangedReply('property')).toBe(
      '✅ No changes needed — this listing is already up to date.\n\n' +
      '_If you intended a different change, tell me what to set._'
    );
    expect(formatRecordUnchangedReply('contact')).toContain('this contact is already up to date');
  });

  it('does not describe an update failure as an unchanged record', () => {
    expect(formatRecordUpdateFailureReply('property')).toBe(
      "⚠️ I couldn't update this listing right now. Please try again in a moment."
    );
    expect(formatRecordUpdateFailureReply('contact')).toContain("couldn't update this contact");
  });

  it('returns unchanged when the requested values already match the stored record', async () => {
    const row = {
      ...property,
      listing_type: 'sale',
      floor_tenancies: [],
      rental_income: null,
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const accountFilter = vi.fn().mockReturnValue({ maybeSingle });
    const idFilter = vi.fn().mockReturnValue({ eq: accountFilter });
    const select = vi.fn().mockReturnValue({ eq: idFilter });
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(supabaseAdmin).mockReturnValue({ from } as unknown as ReturnType<typeof supabaseAdmin>);
    vi.mocked(generateJsonFromParts).mockResolvedValue(JSON.stringify({
      title: row.title,
      price: row.price,
      location: row.location,
      bedrooms: row.bedrooms,
      floor_tenancies: row.floor_tenancies,
      rental_income: row.rental_income,
    }));

    await expect(applyRecordUpdate({
      entityType: 'property',
      entityId: row.id,
      accountId: row.account_id,
      instruction: 'Repeat the same tenant details',
    })).resolves.toBe('unchanged');
  });
});
