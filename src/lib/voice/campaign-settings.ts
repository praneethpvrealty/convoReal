export interface VoiceCampaignSettingsErrors {
  window: string | null;
  attempts: string | null;
}

export function voiceCampaignSettingsErrors(
  startHour: number,
  endHour: number,
  maxAttempts: number
): VoiceCampaignSettingsErrors {
  const hoursValid =
    Number.isInteger(startHour) &&
    Number.isInteger(endHour) &&
    startHour >= 0 &&
    startHour <= 23 &&
    endHour >= 1 &&
    endHour <= 24;
  return {
    window: !hoursValid
      ? '“Calls from” must be a whole hour from 0 to 23 and “Until” from 1 to 24.'
      : endHour <= startHour
        ? '“Until” must be after “Calls from”.'
        : null,
    attempts:
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10
        ? 'Max attempts must be a whole number from 1 to 10.'
        : null,
  };
}
