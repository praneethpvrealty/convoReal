import { describe, expect, it } from 'vitest';
import {
  comparableAreaSqft,
  comparableAreasSqft,
  findPortalDiscrepancies,
  portalFromQuestion,
} from './listing-reconcile';

describe('portalFromQuestion', () => {
  it('reads the portal out of the message that prompted this', () => {
    expect(
      portalFromQuestion('It says as 4000sqft in magicbricks. Is it thecsame one???')
    ).toBe('magicbricks');
  });

  it('handles the spacing and casing people actually type', () => {
    expect(portalFromQuestion('Saw it on Magic Bricks')).toBe('magicbricks');
    expect(portalFromQuestion('the 99acres listing says 3BHK')).toBe('99acres');
    expect(portalFromQuestion('on 99 Acres it was cheaper')).toBe('99acres');
    expect(portalFromQuestion('Housing.com shows a different price')).toBe(
      'housing'
    );
  });

  it('is null when no portal is named', () => {
    expect(portalFromQuestion('is it north facing?')).toBeNull();
    expect(portalFromQuestion('')).toBeNull();
  });
});

describe('comparableAreaSqft', () => {
  it('prefers the built-up area', () => {
    expect(comparableAreaSqft({ area_sqft: 4200, land_area: 9000 })).toBe(4200);
  });

  it('falls back to a land area already held in Sq.Ft.', () => {
    expect(
      comparableAreaSqft({ land_area: 4200, land_area_unit: 'Sq.Ft.' })
    ).toBe(4200);
  });

  it('refuses a land area in another unit rather than inventing a conversion', () => {
    // An acre compared against a portal's sqft would report a
    // discrepancy on every plot we own.
    expect(
      comparableAreaSqft({ land_area: 2, land_area_unit: 'Acres' })
    ).toBeNull();
  });

  it('keeps built-up and plot measurements as valid area semantics', () => {
    expect(
      comparableAreasSqft({
        area_sqft: 5400,
        land_area: 2400,
        land_area_unit: 'Sq.Ft.',
      })
    ).toEqual([5400, 2400]);
  });
});

describe('findPortalDiscrepancies', () => {
  const property = { price: 44_100_000, area_sqft: 4200, bedrooms: null };

  it('catches the 4000-vs-4200 a buyer spotted before we did', () => {
    const drifts = findPortalDiscrepancies(property, [
      { portal: 'magicbricks', areaSqft: 4000, listingUrl: 'https://mb/x' },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({
      portal: 'magicbricks',
      portalLabel: 'MagicBricks',
      field: 'area_sqft',
      ours: 4200,
      theirs: 4000,
      listingUrl: 'https://mb/x',
    });
  });

  it('forgives rounding — 4199 posted as 4200 is the same number', () => {
    expect(
      findPortalDiscrepancies({ area_sqft: 4199 }, [
        { portal: 'housing', areaSqft: 4200 },
      ])
    ).toEqual([]);
  });

  it('does not compare a portal plot area with the built-up area', () => {
    expect(
      findPortalDiscrepancies(
        {
          price: 43_200_000,
          area_sqft: 5400,
          land_area: 2400,
          land_area_unit: 'Sq.Ft.',
        },
        [{ portal: 'housing', price: 43_200_000, areaSqft: 2400 }]
      )
    ).toEqual([]);
  });

  it('compares a genuinely different portal area with the closest listing area', () => {
    const drifts = findPortalDiscrepancies(
      {
        area_sqft: 5400,
        land_area: 2400,
        land_area_unit: 'Sq.Ft.',
      },
      [{ portal: 'housing', areaSqft: 3000 }]
    );
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({
      field: 'area_sqft',
      ours: 2400,
      theirs: 3000,
    });
  });

  it('treats a bedroom count as exact', () => {
    const drifts = findPortalDiscrepancies({ bedrooms: 3 }, [
      { portal: '99acres', bedrooms: 2 },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].field).toBe('bedrooms');
  });

  it('says nothing about a field one side never stated', () => {
    expect(
      findPortalDiscrepancies({ price: 44_100_000, area_sqft: 4200 }, [
        { portal: 'magicbricks', price: null, areaSqft: 4200, bedrooms: 3 },
      ])
    ).toEqual([]);
  });

  it('reports every disagreeing portal, worst drift first', () => {
    const drifts = findPortalDiscrepancies(property, [
      { portal: 'magicbricks', areaSqft: 4000 },
      { portal: '99acres', price: 30_000_000 },
    ]);
    expect(drifts.map((d) => d.portal)).toEqual(['99acres', 'magicbricks']);
  });

  it('is silent for an account that has never portal-synced', () => {
    expect(findPortalDiscrepancies(property, [])).toEqual([]);
  });
});
