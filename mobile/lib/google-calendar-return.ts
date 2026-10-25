export const GOOGLE_CALENDAR_RETURN_URL = 'convoreal://google-calendar';

export type GoogleCalendarReturn =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; error: string };

export function parseGoogleCalendarReturn(url: string): GoogleCalendarReturn {
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [rawKey, ...rest] = pair.split('=');
    try {
      params[decodeURIComponent(rawKey)] = decodeURIComponent(
        rest.join('=').replace(/\+/g, ' ')
      );
    } catch {
      return { kind: 'error', error: 'connection_failed' };
    }
  }
  if (params.code && params.state) {
    return { kind: 'code', code: params.code, state: params.state };
  }
  return { kind: 'error', error: params.error || 'connection_failed' };
}
