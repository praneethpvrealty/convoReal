import { describe, it, expect } from 'vitest';
import { buildRecordPatch } from './record-edit';

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
});
