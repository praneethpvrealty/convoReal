import { describe, expect, it } from 'vitest';

import {
  hasCommercialBuildingFields,
  hasTotalFloors,
  hasUnitFloor,
  isApartmentType,
} from '@/lib/inventory/property-options';

describe('property field visibility', () => {
  it('keeps rent-roll fields off vacant commercial and industrial land', () => {
    expect(hasCommercialBuildingFields('Commercial Land')).toBe(false);
    expect(hasCommercialBuildingFields('Industrial Land')).toBe(false);
    expect(hasCommercialBuildingFields('Commercial Building')).toBe(true);
    expect(hasCommercialBuildingFields('Warehouse/ Godown')).toBe(true);
  });

  it('treats penthouses as building units rather than parcels', () => {
    expect(isApartmentType('Penthouse')).toBe(true);
    expect(isApartmentType('Villa')).toBe(false);
  });

  it('shows a unit floor only for units within a building', () => {
    expect(hasUnitFloor('Flat/ Apartment')).toBe(true);
    expect(hasUnitFloor('Commercial Office Space')).toBe(true);
    expect(hasUnitFloor('Residential House')).toBe(false);
    expect(hasUnitFloor('Commercial Building')).toBe(false);
    expect(hasUnitFloor('Residential Land')).toBe(false);
  });

  it('shows total floors for built assets and never for land', () => {
    expect(hasTotalFloors('Flat/ Apartment')).toBe(true);
    expect(hasTotalFloors('Residential PG building')).toBe(true);
    expect(hasTotalFloors('Agricultural Land')).toBe(false);
    expect(hasTotalFloors('')).toBe(false);
  });
});
