import { describe, expect, it } from 'vitest';

import { agendaPdfPath } from './agenda-pdf';

describe('agendaPdfPath', () => {
  it('asks for the selected calendar day, not the UTC day', () => {
    expect(agendaPdfPath(new Date(2026, 10, 4, 0, 15))).toBe(
      '/api/calendar/agenda-pdf?date=2026-11-04'
    );
    expect(agendaPdfPath(new Date(2026, 0, 9, 23, 59))).toBe(
      '/api/calendar/agenda-pdf?date=2026-01-09'
    );
  });
});
