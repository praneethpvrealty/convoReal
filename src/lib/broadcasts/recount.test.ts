import { describe, it, expect } from 'vitest';
import { contactsLabel, recountOutcome } from './recount';

describe('recountOutcome', () => {
  it('confirms with the fresh count', () => {
    expect(recountOutcome({ isError: false, data: 7 })).toEqual({
      kind: 'confirm',
      count: 7,
      label: '7 contacts',
    });
  });

  it('refuses to confirm when the recount failed, even with an earlier count', () => {
    expect(recountOutcome({ isError: true, data: 5 })).toEqual({
      kind: 'failed',
    });
    expect(recountOutcome({ isError: false, data: undefined })).toEqual({
      kind: 'failed',
    });
  });

  it('stops when nobody is left in the audience', () => {
    expect(recountOutcome({ isError: false, data: 0 })).toEqual({
      kind: 'empty',
    });
  });

  it('reports a changed audience instead of sending to a number nobody saw', () => {
    expect(recountOutcome({ isError: false, data: 9 }, 7)).toEqual({
      kind: 'changed',
      count: 9,
      label: '9 contacts',
    });
    expect(recountOutcome({ isError: false, data: 7 }, 7).kind).toBe('confirm');
  });

  it('labels one contact in the singular and groups large counts', () => {
    expect(contactsLabel(1)).toBe('1 contact');
    expect(contactsLabel(2)).toBe('2 contacts');
    expect(contactsLabel(120000)).toBe('1,20,000 contacts');
  });
});
