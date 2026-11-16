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

describe('[CNV-016] facing, tower and floor come from the requirement, never from agent notes', () => {
  beforeEach(() => generateJson.mockReset());

  it('reads the requirement passed alongside the joined source text', async () => {
    generateJson.mockResolvedValue('{}');
    const requirement = 'East facing in tower 10, 8th to 28th floor';
    const prefs = await extractContactPreferences(
      `${requirement}\nShowed Tower B unit on 14th floor, client rejected it`,
      requirement
    );
    expect(prefs).toMatchObject({
      facing: ['East'],
      towers: ['10'],
      floor_min: 8,
      floor_max: 28,
    });
  });

  it('reads nothing when the requirement is empty and only notes carry a tower', async () => {
    generateJson.mockResolvedValue('{}');
    const prefs = await extractContactPreferences(
      'Showed Tower B unit on 14th floor, client rejected it',
      null
    );
    expect(prefs).toMatchObject({
      facing: [],
      towers: [],
      floor_min: null,
      floor_max: null,
    });
  });

  it('reads the whole text when the caller has no separate notes', async () => {
    generateJson.mockResolvedValue('{}');
    const prefs = await extractContactPreferences('West facing, Tower C');
    expect(prefs).toMatchObject({ facing: ['West'], towers: ['C'] });
  });
});
