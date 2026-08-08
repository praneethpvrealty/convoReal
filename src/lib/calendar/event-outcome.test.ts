import { describe, expect, it } from 'vitest';
import { parseEventOutcome } from './event-outcome';

describe('parseEventOutcome', () => {
  it('reads the reply that prompted this feature', () => {
    expect(
      parseEventOutcome(
        'This is already done. Hari has visited and now he will get back on the owners meeting etc'
      )
    ).toEqual({
      status: 'completed',
      // Verbatim: the agent's sentence is the outcome, and a model
      // paraphrase would be worse than what was typed.
      outcome:
        'This is already done. Hari has visited and now he will get back on the owners meeting etc',
    });
  });

  it('recognises the ways a visit gets reported done', () => {
    for (const text of [
      'Done',
      'Site visit done',
      'The visit is completed',
      'Already over',
      'He has visited the plot',
      'Met him this morning',
      'Went well, they liked the layout',
      'Call done, will revert',
    ]) {
      expect(parseEventOutcome(text)?.status, text).toBe('completed');
    }
  });

  it('recognises a cancellation', () => {
    for (const text of [
      'Cancelled',
      'Cancel this',
      'The client called off the visit',
      "Didn't happen",
      'No show',
      "He didn't turn up",
    ]) {
      expect(parseEventOutcome(text)?.status, text).toBe('cancelled');
    }
  });

  it('leaves a reschedule to the editor', () => {
    // These look superficially like a close-out but the event is very
    // much still on — reading them as cancelled would delete a meeting.
    for (const text of [
      'Postponed to Monday',
      'Move it to 4pm',
      'Reschedule this to tomorrow',
      "Didn't happen, pushing to next week",
      'Shift it to Friday instead',
    ]) {
      expect(parseEventOutcome(text), text).toBeNull();
    }
  });

  it('does not close an event on an ordinary reply', () => {
    for (const text of [
      'Ok thanks',
      'Who is attending?',
      'Please send the layout',
      '',
      null,
      undefined,
    ]) {
      expect(parseEventOutcome(text), String(text)).toBeNull();
    }
  });

  it('stands down when a sentence reports both at once', () => {
    // "The visit is done but the survey was cancelled" — guessing which
    // half is about this event is worse than leaving it to a human.
    expect(
      parseEventOutcome('Visit is done but the survey got cancelled')
    ).toBeNull();
  });
});

describe('parseEventOutcome — a bare "done"', () => {
  it('accepts it when it is the whole reply', () => {
    for (const text of ['Done', 'done.', 'All done', "It's done", 'Done ✅']) {
      expect(parseEventOutcome(text)?.status, text).toBe('completed');
    }
  });

  it('refuses it inside a request', () => {
    // "Can you get this done by 4" is asking for the meeting, not
    // closing it.
    expect(parseEventOutcome('Can you get this done by 4')).toBeNull();
    expect(parseEventOutcome('Need the paperwork done before we meet')).toBeNull();
  });
});

describe('parseEventOutcome — replies seen in production', () => {
  it('reads the reply the nudge actually got', () => {
    // Verbatim from the thread that came back "I couldn't tell what
    // that was". The parse was never the problem — the card it
    // answered had no target row — but pin the sentence so a future
    // tightening of the patterns cannot quietly drop it again.
    const parsed = parseEventOutcome(
      'He visited the property yesterday only and will get back to me.'
    );
    expect(parsed?.status).toBe('completed');
    expect(parsed?.outcome).toBe(
      'He visited the property yesterday only and will get back to me.'
    );
  });

  it('does not read "yesterday" as a reschedule', () => {
    // Only forward-looking words move an event. A visit that happened
    // yesterday is a report, not a request to move anything.
    expect(parseEventOutcome('Met him yesterday, going well')?.status).toBe('completed');
    expect(parseEventOutcome('Visited the site yesterday')?.status).toBe('completed');
  });

  it('still yields to a reschedule that names a new time', () => {
    expect(parseEventOutcome('Visited the site, but push it to tomorrow 4pm')).toBeNull();
  });
});
