import { describe, it, expect } from 'vitest';
import { voiceCampaignSettingsErrors } from './campaign-settings';

describe('voiceCampaignSettingsErrors', () => {
  it('accepts the defaults', () => {
    expect(voiceCampaignSettingsErrors(10, 19, 3)).toEqual({
      window: null,
      attempts: null,
    });
  });

  it('rejects a window that ends before it starts', () => {
    expect(voiceCampaignSettingsErrors(10, 9, 3).window).toBe(
      '“Until” must be after “Calls from”.'
    );
    expect(voiceCampaignSettingsErrors(10, 10, 3).window).not.toBeNull();
  });

  it('rejects hours outside the day or not whole', () => {
    expect(voiceCampaignSettingsErrors(-1, 9, 3).window).not.toBeNull();
    expect(voiceCampaignSettingsErrors(9, 25, 3).window).not.toBeNull();
    expect(voiceCampaignSettingsErrors(9.5, 19, 3).window).not.toBeNull();
    expect(
      voiceCampaignSettingsErrors(Number.NaN, 19, 3).window
    ).not.toBeNull();
    expect(voiceCampaignSettingsErrors(0, 24, 3).window).toBeNull();
  });

  it('rejects attempts outside 1 to 10', () => {
    expect(voiceCampaignSettingsErrors(10, 19, 0).attempts).not.toBeNull();
    expect(voiceCampaignSettingsErrors(10, 19, 11).attempts).not.toBeNull();
    expect(voiceCampaignSettingsErrors(10, 19, 2.5).attempts).not.toBeNull();
    expect(voiceCampaignSettingsErrors(10, 19, 10).attempts).toBeNull();
  });
});
