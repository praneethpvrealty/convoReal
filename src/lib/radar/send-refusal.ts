export type RadarSendRefusalCode =
  'SEND_IN_PROGRESS' | 'ALREADY_SENT' | 'LISTING_UNAVAILABLE';

export const RADAR_SEND_REFUSAL_MESSAGES: Record<RadarSendRefusalCode, string> =
  {
    SEND_IN_PROGRESS: 'This alert is already being sent.',
    ALREADY_SENT: 'This alert was already sent.',
    LISTING_UNAVAILABLE:
      'This listing is no longer available, so its alert was not sent.',
  };

export function isRadarSendRefusal(
  code: unknown
): code is RadarSendRefusalCode {
  return (
    code === 'SEND_IN_PROGRESS' ||
    code === 'ALREADY_SENT' ||
    code === 'LISTING_UNAVAILABLE'
  );
}

export function radarSendRefusalMessage(code: unknown): string | null {
  return isRadarSendRefusal(code) ? RADAR_SEND_REFUSAL_MESSAGES[code] : null;
}
