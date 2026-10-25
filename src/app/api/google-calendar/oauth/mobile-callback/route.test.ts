import { describe, expect, it } from 'vitest';

import { GET } from './route';

function get(params: Record<string, string>) {
  const url = new URL(
    'https://app.test/api/google-calendar/oauth/mobile-callback'
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return GET(new Request(url));
}

describe('[CAL-015] GET /api/google-calendar/oauth/mobile-callback', () => {
  it('[CAL-015] hands the code and state back to the app and connects nothing itself', async () => {
    const res = await get({ code: '4/0Ab', state: 'eyJ.sig' });
    expect(res.headers.get('location')).toBe(
      'convoreal://google-calendar?code=4%2F0Ab&state=eyJ.sig'
    );
  });

  it('[CAL-015] reports a cancelled or incomplete consent to the app', async () => {
    const cases: Array<Record<string, string>> = [
      { error: 'access_denied', state: 's' },
      { state: 's' },
      { code: 'c' },
    ];
    for (const params of cases) {
      const res = await get(params);
      expect(res.headers.get('location')).toBe(
        'convoreal://google-calendar?error=consent_denied'
      );
    }
  });
});
