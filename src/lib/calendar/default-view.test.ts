import { describe, expect, it } from 'vitest';

import {
  CALENDAR_VIEW_STORAGE_KEY,
  SPARSE_MONTH_THRESHOLD,
  resolveInitialView,
  toCalendarView,
} from './default-view';

describe('the calendar opens in the view the user last chose', () => {
  it('keeps a remembered view whatever the month holds', () => {
    expect(resolveInitialView('week', 0)).toBe('week');
    expect(resolveInitialView('month', 0)).toBe('month');
    expect(resolveInitialView('team', 40)).toBe('team');
  });

  it('opens a sparse month in the Agenda and a busy one in the grid', () => {
    expect(SPARSE_MONTH_THRESHOLD).toBe(5);
    expect(resolveInitialView(null, 0)).toBe('agenda');
    expect(resolveInitialView(undefined, 4)).toBe('agenda');
    expect(resolveInitialView(null, 5)).toBe('month');
    expect(resolveInitialView(null, 12)).toBe('month');
  });

  it('ignores an unknown stored value', () => {
    expect(toCalendarView('kanban')).toBeNull();
    expect(toCalendarView(3)).toBeNull();
    expect(resolveInitialView('kanban', 9)).toBe('month');
    expect(CALENDAR_VIEW_STORAGE_KEY).toBe('convoreal.calendar.view');
  });
});
