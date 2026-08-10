import { describe, it, expect } from 'vitest';
import {
  looksLikeSchedulingText,
  isAgendaCommand,
  splitTaskList,
  isDictatedTaskList,
  formatAgendaMessage,
  formatInboundConfirmation,
  istDayWindow,
} from './whatsapp-scheduler';

describe('looksLikeSchedulingText', () => {
  it('accepts explicit scheduling requests', () => {
    expect(looksLikeSchedulingText('Remind me to call Snigdha tomorrow at 5pm')).toBe(true);
    expect(looksLikeSchedulingText('Schedule site visit with Varun on Saturday')).toBe(true);
    expect(looksLikeSchedulingText('site visit at JP Nagar tomorrow 4pm')).toBe(true);
    expect(looksLikeSchedulingText('Follow up with Maltesh on the EC documents')).toBe(true);
    expect(looksLikeSchedulingText('task: send brochure to Rakesh')).toBe(true);
  });

  it('accepts verb + time-cue combinations', () => {
    expect(looksLikeSchedulingText('call varun tomorrow')).toBe(true);
    expect(looksLikeSchedulingText('meet the builder at 11am')).toBe(true);
    expect(looksLikeSchedulingText('call the bank at 16:30')).toBe(true);
    expect(looksLikeSchedulingText('site visit this saturday')).toBe(true);
  });

  it('accepts an explicit calendar date, which is how anyone books past next week', () => {
    // The reported failure: this became a contact draft, because only
    // relative days and clock times counted as a WHEN.
    expect(
      looksLikeSchedulingText(
        'Meet lawyer Kusuma Muniraju regarding Whitefield sharans property on 30th July 2026.'
      )
    ).toBe(true);
    expect(looksLikeSchedulingText('meeting with the lawyer on 30 July')).toBe(true);
    expect(looksLikeSchedulingText('call Deepak Aug 3')).toBe(true);
    expect(looksLikeSchedulingText('registration appointment 12/08/2026')).toBe(true);
    expect(looksLikeSchedulingText('meet Suresh on Friday')).toBe(true);
  });

  it('does not care whether the WHEN comes before the verb, or on its own line', () => {
    expect(looksLikeSchedulingText('On 30th July, meet the lawyer')).toBe(true);
    expect(looksLikeSchedulingText('Meet lawyer Kusuma\non 30th July 2026')).toBe(true);
  });

  it('rejects forwarded property listings', () => {
    expect(
      looksLikeSchedulingText(
        '3BHK flat for sale in JP Nagar, 1850 sqft, 1.2 crore, east facing, site visit welcome'
      )
    ).toBe(false);
    expect(looksLikeSchedulingText('2 BHK 1100 sqft rent 25000 HSR layout')).toBe(false);
  });

  it('rejects plain conversation and lead forwards', () => {
    expect(looksLikeSchedulingText('Rakesh is interested in the HSR flat, 9880011223')).toBe(false);
    expect(looksLikeSchedulingText('ok thanks')).toBe(false);
    expect(looksLikeSchedulingText('')).toBe(false);
  });

  it('leaves a forwarded lead to contact intake even when it names a day', () => {
    // The date cue must not pull portal leads out of ingestion: this is a
    // contact to create, not a meeting to book.
    expect(
      looksLikeSchedulingText('Gaurav 9880011223 is interested in the HSR plot, call him on Monday')
    ).toBe(false);
    expect(
      looksLikeSchedulingText('New lead from MagicBricks — Suresh, wants a site visit 30/07')
    ).toBe(false);
  });

  it('still lets an outright request through a lead forward', () => {
    expect(
      looksLikeSchedulingText('Remind me to call Gaurav who is interested in the HSR plot on Monday')
    ).toBe(true);
  });

  it('does not treat a bare date or a bare verb as a request', () => {
    expect(looksLikeSchedulingText('30th July 2026')).toBe(false);
    expect(looksLikeSchedulingText('did you meet him?')).toBe(false);
    expect(looksLikeSchedulingText('what was the call about')).toBe(false);
  });

  it('does not read property figures as a date or a time', () => {
    // "2-3 crore" is a budget, "3.50 acres" is a size — neither is a WHEN.
    expect(looksLikeSchedulingText('met the owner, he wants 2-3 crore')).toBe(false);
    expect(looksLikeSchedulingText('visit was for the 3.50 acre land')).toBe(false);
  });

  it('still accepts an explicit "remind me" even with listing words', () => {
    expect(
      looksLikeSchedulingText('Remind me tomorrow to update the 3BHK 1850 sqft listing price to 1.3 crore')
    ).toBe(true);
  });
});

const DICTATED_LIST =
  "Add for today's task 1) Send Hoskote Road 12 acres land to all developers via email too. " +
  '2) List SLV JP Nagar property onto Housing and magicbricks ' +
  '3) Followup with Ashwath Reddy regarding a) Whitefield MNG Business centre proposal status ' +
  "b) Koramangala NW corner Varun's property";

describe('looksLikeSchedulingText — a dictated task list', () => {
  it('accepts the list that was filed as a property draft', () => {
    // The reported bug. "followup with" made it a scheduling request,
    // but "task 1)" missed TASK_PREFIX so it never earned the
    // stated-outright pass — and then "magicbricks" tripped the
    // forwarded-lead back-off, so an agenda became a listing intake.
    expect(looksLikeSchedulingText(DICTATED_LIST)).toBe(true);
  });

  it('survives a portal name the owner is telling us to post TO', () => {
    expect(
      looksLikeSchedulingText('Task 1) list the JP Nagar flat on magicbricks 2) call Ravi')
    ).toBe(true);
  });

  it('still turns away a forwarded portal lead', () => {
    // The back-off has to keep working: a lead with a phone number and
    // a "call him" belongs to contact ingestion, not the calendar.
    expect(
      looksLikeSchedulingText(
        'New lead from magicbricks, Rakesh 9845012345, is interested in the Hoodi plot, call him Monday'
      )
    ).toBe(false);
  });
});

describe('splitTaskList', () => {
  it('splits the dictated list into its three jobs', () => {
    expect(splitTaskList(DICTATED_LIST)).toEqual([
      'Send Hoskote Road 12 acres land to all developers via email too',
      'List SLV JP Nagar property onto Housing and magicbricks',
      "Followup with Ashwath Reddy regarding a) Whitefield MNG Business centre proposal status b) Koramangala NW corner Varun's property",
    ]);
  });

  it('keeps lettered sub-items inside the job that introduced them', () => {
    // Item 3 raises two things with one person. Three jobs, not four.
    expect(splitTaskList(DICTATED_LIST)).toHaveLength(3);
  });

  it('is empty for a single request, leaving the AI path alone', () => {
    expect(splitTaskList('remind me to call Ravi tomorrow at 5')).toEqual([]);
    expect(splitTaskList('task: send the brochure')).toEqual([]);
    expect(splitTaskList('')).toEqual([]);
  });

  it('does not read a quantity as a heading', () => {
    // "12 acres" and "2 km" are numbers in a sentence. A marker needs
    // its separator and its place in the run.
    expect(splitTaskList('Plot of 12 acres, 2 km from ORR')).toEqual([]);
    expect(splitTaskList('3) only item, numbered from three')).toEqual([]);
  });

  it('handles newline-separated lists and a trailing full stop', () => {
    expect(splitTaskList('Tasks\n1. Call Ravi.\n2. Send the EC.')).toEqual([
      'Call Ravi',
      'Send the EC',
    ]);
  });
});


describe('isDictatedTaskList', () => {
  it('is true for a list that says it is one and numbers it', () => {
    expect(isDictatedTaskList(DICTATED_LIST)).toBe(true);
  });

  it('survives an item that mentions the word task again', () => {
    // The retest: "...via email too, inform Chamraju after this task
    // 2) List SLV..." The second marker is preceded by that word, and
    // the run still counts 1, 2, 3.
    const v2 =
      "Add for today's task 1) Send Hoskote Road land to all developers, inform Chamraju after this task " +
      '2) List SLV JP Nagar property onto Housing and magicbricks ' +
      '3) Followup with Ashwath Reddy';
    expect(isDictatedTaskList(v2)).toBe(true);
    expect(splitTaskList(v2)).toHaveLength(3);
  });

  it('is false for anything that could be an intake correction', () => {
    // This predicate is allowed to interrupt a draft session, so it has
    // to be certain. A listing correction must never match.
    for (const text of [
      'price is 2.5 cr',
      'task: send the brochure',
      '3 BHK 1450 sqft, 2 covered parkings',
      'site visit tomorrow 4pm',
      '',
      null,
    ]) {
      expect(isDictatedTaskList(text), String(text)).toBe(false);
    }
  });
});

describe('isAgendaCommand', () => {
  it('matches agenda keywords case-insensitively', () => {
    expect(isAgendaCommand('today')).toBe(true);
    expect(isAgendaCommand('Agenda')).toBe(true);
    expect(isAgendaCommand("today's schedule")).toBe(true);
    expect(isAgendaCommand('my day')).toBe(true);
  });

  it('does not match longer sentences', () => {
    expect(isAgendaCommand('what am I doing today with Varun')).toBe(false);
  });
});

describe('formatAgendaMessage', () => {
  it('lists events in IST with type emoji and contact', () => {
    const msg = formatAgendaMessage(
      'Tuesday, 14 Jul',
      [
        {
          title: 'Site visit JP Nagar',
          event_type: 'site_visit',
          start_time: '2026-07-14T10:30:00.000Z', // 4:00 pm IST
          location: 'JP Nagar 5th Phase',
          status: 'scheduled',
          contact: { name: 'Varun' },
        },
      ],
      [{ title: 'Send EC to Snigdha', priority: 'high' }]
    );
    expect(msg).toContain('4:00 pm');
    expect(msg).toContain('Site visit JP Nagar');
    expect(msg).toContain('Varun');
    expect(msg).toContain('JP Nagar 5th Phase');
    expect(msg).toContain('Send EC to Snigdha');
    expect(msg).toContain('🔴');
  });

  it('has a friendly empty state', () => {
    const msg = formatAgendaMessage('Tuesday, 14 Jul', [], []);
    expect(msg).toContain('Nothing scheduled');
  });

  it('shows a task dictated without a day instead of dropping it', () => {
    const msg = formatAgendaMessage(
      'Wednesday, 5 Aug',
      [],
      [{ title: 'Follow up on corner properties', priority: 'medium', due_date: null }]
    );
    expect(msg).not.toContain('Nothing scheduled');
    expect(msg).toContain('Follow up on corner properties');
    expect(msg).toContain('No date set');
  });

  it('keeps dated and undated tasks in separate sections', () => {
    const msg = formatAgendaMessage(
      'Wednesday, 5 Aug',
      [],
      [
        { title: 'Send EC to Snigdha', priority: 'high', due_date: '2026-08-05T06:00:00.000Z' },
        { title: 'Follow up on corner properties', priority: 'medium', due_date: null },
      ]
    );
    const dueIdx = msg.indexOf('Tasks due:');
    const undatedIdx = msg.indexOf('No date set');
    expect(dueIdx).toBeGreaterThan(-1);
    expect(undatedIdx).toBeGreaterThan(dueIdx);
    expect(msg.slice(dueIdx, undatedIdx)).toContain('Send EC to Snigdha');
    expect(msg.slice(undatedIdx)).toContain('Follow up on corner properties');
  });

  it('truncates a long undated backlog so it cannot bury the day', () => {
    const msg = formatAgendaMessage(
      'Wednesday, 5 Aug',
      [],
      Array.from({ length: 8 }, (_, i) => ({
        title: `Task ${i}`,
        priority: 'medium',
        due_date: null,
      }))
    );
    expect(msg).toContain('Task 4');
    expect(msg).not.toContain('Task 5');
    expect(msg).toContain('+3 more');
  });
});

describe('formatInboundConfirmation', () => {
  it('greets the lead and shows the event in IST with property and location', () => {
    const msg = formatInboundConfirmation({
      contactName: 'Rakesh',
      title: 'Site visit - JP Nagar flat',
      eventType: 'site_visit',
      startIso: '2026-07-25T09:30:00.000Z', // 3:00 pm IST
      propertyTitle: '3BHK JP Nagar',
      location: 'JP Nagar 5th Phase',
    });
    expect(msg).toContain('Hi Rakesh,');
    expect(msg).toContain('Site visit - JP Nagar flat');
    expect(msg).toContain('3:00 pm');
    expect(msg).toContain('3BHK JP Nagar');
    expect(msg).toContain('JP Nagar 5th Phase');
    expect(msg).toContain('confirm shortly');
  });

  it('falls back to a generic greeting and omits optional lines', () => {
    const msg = formatInboundConfirmation({
      contactName: null,
      title: 'Call about the plot',
      eventType: 'call',
      startIso: '2026-07-25T09:30:00.000Z',
      propertyTitle: null,
      location: null,
    });
    expect(msg).toContain('Hi there,');
    expect(msg).not.toContain('🏡');
    expect(msg).not.toContain('📌');
  });
});

describe('istDayWindow', () => {
  it('spans IST midnight to midnight', () => {
    // 2026-07-14 02:00 IST = 2026-07-13 20:30 UTC
    const { startIso, endIso, label } = istDayWindow(new Date('2026-07-13T20:30:00.000Z'));
    expect(startIso).toBe('2026-07-13T18:30:00.000Z'); // 14 Jul 00:00 IST
    expect(endIso).toBe('2026-07-14T18:30:00.000Z');
    expect(label).toContain('14');
  });
});
