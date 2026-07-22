import { describe, it, expect } from 'vitest';

import { parseBuyerAlertsCommand } from './alerts';

describe('parseBuyerAlertsCommand', () => {
  it('matches stop/pause and start/resume phrasings', () => {
    expect(parseBuyerAlertsCommand('STOP ALERTS')).toBe('stop');
    expect(parseBuyerAlertsCommand('pause alerts')).toBe('stop');
    expect(parseBuyerAlertsCommand('stop property alerts')).toBe('stop');
    expect(parseBuyerAlertsCommand('Stop deal alerts')).toBe('stop');
    expect(parseBuyerAlertsCommand('START ALERTS')).toBe('start');
    expect(parseBuyerAlertsCommand('resume alerts')).toBe('start');
    expect(parseBuyerAlertsCommand('start property alerts')).toBe('start');
  });

  it('ignores normal conversation', () => {
    expect(parseBuyerAlertsCommand('please stop sending me alerts')).toBeNull();
    expect(parseBuyerAlertsCommand('stop')).toBeNull();
    expect(parseBuyerAlertsCommand('any alerts?')).toBeNull();
    expect(parseBuyerAlertsCommand('stop updates')).toBeNull();
    expect(parseBuyerAlertsCommand(null)).toBeNull();
    expect(parseBuyerAlertsCommand(undefined)).toBeNull();
  });
});
