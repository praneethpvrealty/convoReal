export type RadarSendRefusalCode = 'SEND_IN_PROGRESS' | 'ALREADY_SENT';

export const RADAR_SEND_REFUSAL_MESSAGES: Record<RadarSendRefusalCode, string> =
  {
    SEND_IN_PROGRESS: 'This alert is already being sent.',
    ALREADY_SENT: 'This alert was already sent.',
  };

export function isRadarSendRefusal(
  code: unknown
): code is RadarSendRefusalCode {
  return code === 'SEND_IN_PROGRESS' || code === 'ALREADY_SENT';
}

export function radarSendRefusalMessage(code: unknown): string | null {
  return isRadarSendRefusal(code) ? RADAR_SEND_REFUSAL_MESSAGES[code] : null;
}
