import { describe, expect, it } from 'vitest';

import { parseGoogleCalendarReturn } from './google-calendar-return';

describe('[CAL-015] parseGoogleCalendarReturn', () => {
  it('reads the code and state the callback hands back', () => {
    expect(
      parseGoogleCalendarReturn(
        'convoreal://google-calendar?code=4%2F0Ab&state=eyJ.abc'
      )
    ).toEqual({ kind: 'code', code: '4/0Ab', state: 'eyJ.abc' });
  });

  it('reports a cancelled consent', () => {
    expect(
      parseGoogleCalendarReturn(
        'convoreal://google-calendar?error=consent_denied'
      )
    ).toEqual({ kind: 'error', error: 'consent_denied' });
  });

  it('treats a return without a code as a failure', () => {
    expect(parseGoogleCalendarReturn('convoreal://google-calendar')).toEqual({
      kind: 'error',
      error: 'connection_failed',
    });
  });
});
