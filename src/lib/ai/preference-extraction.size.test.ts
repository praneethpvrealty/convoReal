import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateJson = vi.fn();
vi.mock('./gemini', () => ({ generateJson }));

const { extractContactPreferences } = await import('./preference-extraction');

describe('extractContactPreferences plot size', () => {
  beforeEach(() => generateJson.mockReset());

  it('[CTM-016] stores a bare plot size as a floor even when the model returns a point', async () => {
    generateJson.mockResolvedValue(
      JSON.stringify({
        property_types: ['Residential Plot'],
        property_categories: ['residential', 'plot'],
        land_area_min_sqft: 4000,
        land_area_max_sqft: 4000,
      })
    );

    const prefs = await extractContactPreferences(
      'Residential plot 4000 sqft, any area'
    );

    expect(prefs.land_area_min_sqft).toBe(4000);
    expect(prefs.land_area_max_sqft).toBeNull();
  });

  it('[CTM-016] keeps a 30x40 site as the size the buyer named', async () => {
    generateJson.mockResolvedValue(
      JSON.stringify({
        property_types: ['Residential Plot'],
        land_area_min_sqft: 1200,
        land_area_max_sqft: 1200,
      })
    );

    const prefs = await extractContactPreferences('30x40 site in JP Nagar');

    expect(prefs.land_area_min_sqft).toBe(1200);
    expect(prefs.land_area_max_sqft).toBe(1200);
  });
});
