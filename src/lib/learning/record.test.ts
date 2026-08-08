import { describe, expect, it } from 'vitest';
import { prepareFacts } from './record';

describe('prepareFacts', () => {
  it('accepts a well-formed new property fact and marks it for review', () => {
    expect(
      prepareFacts(
        'property',
        { seller_final_price_per_sqft: null },
        [{ field: 'seller_final_price_per_sqft', value: 10500 }]
      )
    ).toEqual([
      {
        field: 'seller_final_price_per_sqft',
        column: 'seller_final_price_per_sqft',
        value: 10500,
        previous: null,
        disposition: 'propose',
      },
    ]);
  });

  it('marks a buyer preference for immediate application', () => {
    const prepared = prepareFacts('contact', { pref_budget_max: null }, [
      { field: 'pref_budget_max', value: 50_000_000 },
    ]);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].disposition).toBe('auto');
  });

  it('drops a field outside the registry — the model does not choose the schema', () => {
    expect(
      prepareFacts('property', {}, [
        { field: 'is_published', value: 1 },
        { field: 'account_id', value: 'someone-elses-account' },
        { field: 'price', value: 1 },
      ])
    ).toEqual([]);
  });

  it('drops a value the bounds reject', () => {
    expect(
      prepareFacts('property', {}, [
        { field: 'seller_final_price_per_sqft', value: 10.5 },
      ])
    ).toEqual([]);
  });

  it('drops a fact the record already states', () => {
    expect(
      prepareFacts(
        'property',
        { seller_final_price_per_sqft: 10500 },
        [{ field: 'seller_final_price_per_sqft', value: 10500 }]
      )
    ).toEqual([]);
  });

  it('drops a list that only changed order', () => {
    expect(
      prepareFacts('contact', { pref_areas: ['HSR Layout', 'Koramangala'] }, [
        { field: 'pref_areas', value: ['koramangala', 'hsr layout'] },
      ])
    ).toEqual([]);
  });

  it('keeps a genuinely changed list', () => {
    const prepared = prepareFacts('contact', { pref_areas: ['HSR Layout'] }, [
      { field: 'pref_areas', value: ['HSR Layout', 'Devanahalli'] },
    ]);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].value).toEqual(['HSR Layout', 'Devanahalli']);
    expect(prepared[0].previous).toEqual(['HSR Layout']);
  });

  it('keeps only the first candidate per field', () => {
    const prepared = prepareFacts('property', {}, [
      { field: 'seller_final_price', value: 44_000_000 },
      { field: 'seller_final_price', value: 42_000_000 },
    ]);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].value).toBe(44_000_000);
  });

  it('partitions a mixed batch by disposition', () => {
    const prepared = prepareFacts(
      'contact',
      { pref_budget_max: null, pref_areas: [] },
      [
        { field: 'pref_budget_max', value: 50_000_000 },
        { field: 'pref_areas', value: ['Devanahalli'] },
        { field: 'seller_final_price', value: 44_000_000 },
      ]
    );
    // seller_final_price is a property field — not reachable on a contact.
    expect(prepared.map((f) => f.field).sort()).toEqual([
      'pref_areas',
      'pref_budget_max',
    ]);
    expect(prepared.every((f) => f.disposition === 'auto')).toBe(true);
  });
});

describe('prepareFacts — non-column applies', () => {
  it('proposes tags the contact does not already carry', () => {
    const prepared = prepareFacts('contact', { tags: ['Investor'] }, [
      { field: 'tags', value: ['Investor', 'NRI'] },
    ]);
    expect(prepared).toEqual([
      {
        field: 'tags',
        column: 'tags',
        value: ['Investor', 'NRI'],
        previous: ['Investor'],
        disposition: 'propose',
      },
    ]);
  });

  it('drops a tag proposal that matches what is already attached', () => {
    expect(
      prepareFacts('contact', { tags: ['Investor', 'NRI'] }, [
        { field: 'tags', value: ['nri', 'investor'] },
      ])
    ).toEqual([]);
  });

  it('reads a tag fact from the tag names, never from a column', () => {
    // `tags` has no column on contacts; keying the novelty check off
    // policy.column would compare against undefined and re-propose the
    // same tags on every message.
    const prepared = prepareFacts(
      'contact',
      { tags: ['Investor'], pref_areas: ['HSR'] },
      [{ field: 'tags', value: ['Investor'] }]
    );
    expect(prepared).toEqual([]);
  });
});
