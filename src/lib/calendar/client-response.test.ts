import { describe, expect, it } from 'vitest';
import { clientResponse, clientResponseNotice } from './client-response';

describe('clientResponse', () => {
  it('[CAL-021] lets an open reschedule request win over an earlier confirmation', () => {
    expect(
      clientResponse({
        reschedule_requested_at: '2026-11-19T02:37:00.000Z',
        client_confirmed_at: '2026-11-18T10:00:00.000Z',
      })
    ).toEqual({
      kind: 'reschedule_requested',
      at: '2026-11-19T02:37:00.000Z',
    });
  });

  it('[CAL-021] shows a confirmation only when no reschedule is open', () => {
    expect(
      clientResponse({ client_confirmed_at: '2026-11-18T10:00:00.000Z' })
    ).toEqual({ kind: 'confirmed', at: '2026-11-18T10:00:00.000Z' });
    expect(clientResponse({})).toBeNull();
  });

  it('[CAL-021] dates the notice in IST and says the reminders are held', () => {
    expect(
      clientResponseNotice({
        kind: 'reschedule_requested',
        at: '2026-11-19T02:37:00.000Z',
      })
    ).toBe(
      'Client requested a reschedule on 19 Nov, 8:07 am. Reminders for this time are on hold; moving the event clears this notice.'
    );
  });
});
