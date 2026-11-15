import { describe, expect, it } from 'vitest';
import { approveListingPrompt } from './approve-listing-prompt';

describe('approveListingPrompt', () => {
  it('[CTM-017] asks which listing when the lead has none linked, quoting what the portal named', () => {
    const prompt = approveListingPrompt({
      last_inquired_property_id: null,
      source: 'Magic Bricks',
      pref_areas: ['Meridian Park at The Prestige City'],
    });
    expect(prompt?.title).toBe('Which listing did they enquire about?');
    expect(prompt?.message).toContain(
      'Their Magic Bricks enquiry names "Meridian Park at The Prestige City"'
    );
    expect(prompt?.skipLabel).toBe('Approve without a listing');
  });

  it('[CTM-017] still asks when the enquiry named nothing', () => {
    const prompt = approveListingPrompt({ areas_of_interest: [' '] });
    expect(
      prompt?.message.startsWith('No listing is linked to this lead.')
    ).toBe(true);
  });

  it('[CTM-017] does not ask when a listing is already linked', () => {
    expect(
      approveListingPrompt({ last_inquired_property_id: 'prop-1' })
    ).toBeNull();
  });
});
