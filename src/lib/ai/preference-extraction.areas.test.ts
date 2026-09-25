import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateJson = vi.fn();
vi.mock('./gemini', () => ({ generateJson }));

const { extractContactPreferences } = await import('./preference-extraction');

describe('extractContactPreferences areas', () => {
  beforeEach(() => generateJson.mockReset());

  it('[CTM-010] drops door numbers and bare address words the model returns as areas', async () => {
    generateJson.mockResolvedValue(
      JSON.stringify({
        areas: [
          '#365',
          'JP Nagar 6th Phase',
          'Block',
          '24th Main',
          'Sector 6 HSR Layout',
        ],
        excluded_areas: ['Sy. No. 153/3', 'Whitefield'],
      })
    );

    const prefs = await extractContactPreferences(
      'Plot near #365, 24th Main, JP Nagar 6th Phase or Sector 6 HSR Layout. Not Whitefield.'
    );

    expect(prefs.areas).toEqual(['JP Nagar 6th Phase', 'Sector 6 HSR Layout']);
    expect(prefs.excluded_areas).toEqual(['Whitefield']);
  });
});
