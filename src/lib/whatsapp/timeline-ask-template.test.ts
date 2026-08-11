import { describe, it, expect } from 'vitest';
import {
  buildFollowupReminderTemplatePayload,
  buildTimelineAskParams,
  buildTimelineAskTemplatePayload,
  timelineButtonAction,
  timelineChoiceForAction,
  timelineTemplateParams,
  FOLLOWUP_REMINDER_TEMPLATE_NAME,
  TIMELINE_ASK_TEMPLATE_NAME,
  TIMELINE_ASK_TEMPLATE_NAMES,
  TIMELINE_CHOICES,
} from './timeline-ask-template';
import { pickApprovedTemplate } from './pick-approved-template';
import { matchTemplateButton, templateButtonLabel } from './template-copy';
import { validateTemplatePayload } from './template-validators';
import { missingEngineTemplates } from './engine-templates';
import { LANGUAGE_CODES } from '@/lib/languages';

const ORIGIN = 'https://acme.convoreal.com';

describe('buildTimelineAskTemplatePayload', () => {
  it('produces a payload the submit API accepts, as Utility', () => {
    const payload = buildTimelineAskTemplatePayload(ORIGIN);
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(TIMELINE_ASK_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
  });

  it('asks only WHEN — never whether, and never what else is available', () => {
    const body = buildTimelineAskTemplatePayload(ORIGIN).body_text ?? '';
    expect(body).toMatch(/when we should check back/i);
    expect(body).not.toMatch(/still under consideration/i);
    expect(body).not.toMatch(/no longer available/i);
  });

  it('is enquiry-anchored, not interest-anchored', () => {
    // "we noticed your interest" / "keeping a tab on you" is
    // re-engagement, which categorises Marketing and cannot be undone.
    const body = buildTimelineAskTemplatePayload(ORIGIN).body_text ?? '';
    expect(body).toMatch(/enquiry/i);
    expect(body).not.toMatch(/interest/i);
    expect(body).not.toMatch(/keep(ing)? a tab/i);
  });

  it('avoids the vocabulary that reads as promotional at review', () => {
    const payload = buildTimelineAskTemplatePayload(ORIGIN);
    const text = [
      payload.body_text ?? '',
      payload.footer_text ?? '',
      ...(payload.buttons ?? []).map((b) => b.text),
    ].join(' ');
    for (const word of ['options', 'deals', 'offer', 'alerts']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
    expect(payload.footer_text ?? '').toBe('');
  });

  it('carries the three choices as quick replies and nothing else', () => {
    const buttons = buildTimelineAskTemplatePayload(ORIGIN).buttons ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.type === 'QUICK_REPLY')).toBe(true);
    expect(buttons.map((b) => b.text)).toEqual([
      'Today itself',
      'In 2 days',
      "Can't say yet",
    ]);
  });

  it('is offered for one-tap creation when the account has no row', () => {
    expect(missingEngineTemplates([]).map((t) => t.name)).toContain(
      TIMELINE_ASK_TEMPLATE_NAME
    );
    expect(
      missingEngineTemplates([TIMELINE_ASK_TEMPLATE_NAME]).map((t) => t.name)
    ).not.toContain(TIMELINE_ASK_TEMPLATE_NAME);
  });
});

// The first attempt at this job came back Marketing. These lock the
// shape that differs — a dated item on the lead's own record, movable
// from the buttons — against the four reminder templates this account
// already holds Utility on.
describe('buildFollowupReminderTemplatePayload', () => {
  it('produces a payload the submit API accepts, as Utility', () => {
    const payload = buildFollowupReminderTemplatePayload(ORIGIN);
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(FOLLOWUP_REMINDER_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
  });

  it('names a concrete follow-up date the lead can confirm or move', () => {
    const body = buildFollowupReminderTemplatePayload(ORIGIN).body_text ?? '';
    expect(body).toMatch(/\{\{4\}\}/);
    expect(body).toMatch(/scheduled/i);
    expect(body).toMatch(/confirm this date or move it/i);
  });

  it('never describes outreach we intend to make — that is what failed', () => {
    const body = buildFollowupReminderTemplatePayload(ORIGIN).body_text ?? '';
    expect(body).not.toMatch(/when we should check back/i);
    expect(body).not.toMatch(/interest/i);
  });

  it('avoids the vocabulary that reads as promotional at review', () => {
    const payload = buildFollowupReminderTemplatePayload(ORIGIN);
    const text = [
      payload.body_text ?? '',
      payload.footer_text ?? '',
      ...(payload.buttons ?? []).map((b) => b.text),
    ].join(' ');
    for (const word of ['options', 'deals', 'offer', 'alerts']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('samples all four params, so Meta reviews a filled message', () => {
    const payload = buildFollowupReminderTemplatePayload(ORIGIN);
    expect(payload.sample_values?.body).toHaveLength(4);
  });
});

describe('timelineTemplateParams', () => {
  const args = {
    contactName: 'Surya Bajaj',
    brandName: 'Aryavarta Ventures',
    propertyDescription: '3 acres in Sarjapur',
    followUpDate: '14 Aug 2026',
  };

  // The two candidates have different placeholder counts; sending one
  // shape against the other's body is a param-count failure at Meta.
  it('adds the date only for the reminder', () => {
    expect(
      timelineTemplateParams(FOLLOWUP_REMINDER_TEMPLATE_NAME, args)
    ).toEqual([
      'Surya',
      'Aryavarta Ventures',
      '3 acres in Sarjapur',
      '14 Aug 2026',
    ]);
    expect(timelineTemplateParams(TIMELINE_ASK_TEMPLATE_NAME, args)).toEqual([
      'Surya',
      'Aryavarta Ventures',
      '3 acres in Sarjapur',
    ]);
  });

  it('matches the placeholder count its body declares', () => {
    for (const [name, build] of [
      [FOLLOWUP_REMINDER_TEMPLATE_NAME, buildFollowupReminderTemplatePayload],
      [TIMELINE_ASK_TEMPLATE_NAME, buildTimelineAskTemplatePayload],
    ] as const) {
      const body = build(ORIGIN).body_text ?? '';
      const placeholders = new Set(body.match(/\{\{\d+\}\}/g) ?? []);
      expect(timelineTemplateParams(name, args), name).toHaveLength(
        placeholders.size
      );
    }
  });
});

describe('candidate preference', () => {
  // Meta fixes a category at first review, so the Marketing row keeps
  // sending until the Utility one is approved — then it must lose.
  it('prefers the approved Utility reminder over the approved Marketing row', () => {
    const chosen = pickApprovedTemplate(
      [
        {
          name: TIMELINE_ASK_TEMPLATE_NAME,
          status: 'APPROVED',
          category: 'Marketing',
        },
        {
          name: FOLLOWUP_REMINDER_TEMPLATE_NAME,
          status: 'APPROVED',
          category: 'Utility',
        },
      ],
      TIMELINE_ASK_TEMPLATE_NAMES
    );
    expect(chosen?.name).toBe(FOLLOWUP_REMINDER_TEMPLATE_NAME);
  });

  it('still sends the Marketing row while the reminder is in review', () => {
    const chosen = pickApprovedTemplate(
      [
        {
          name: TIMELINE_ASK_TEMPLATE_NAME,
          status: 'APPROVED',
          category: 'Marketing',
        },
        {
          name: FOLLOWUP_REMINDER_TEMPLATE_NAME,
          status: 'PENDING',
          category: 'Utility',
        },
      ],
      TIMELINE_ASK_TEMPLATE_NAMES
    );
    expect(chosen?.name).toBe(TIMELINE_ASK_TEMPLATE_NAME);
  });

  it('sends nothing when neither is approved', () => {
    expect(
      pickApprovedTemplate(
        [
          {
            name: FOLLOWUP_REMINDER_TEMPLATE_NAME,
            status: 'REJECTED',
            category: 'Utility',
          },
        ],
        TIMELINE_ASK_TEMPLATE_NAMES
      )
    ).toBeNull();
  });
});

describe('timeline choice round-trip', () => {
  it('maps every choice to an action and back', () => {
    for (const choice of TIMELINE_CHOICES) {
      expect(timelineChoiceForAction(timelineButtonAction(choice))).toBe(
        choice
      );
    }
  });

  it('ignores another template button and a non-match', () => {
    expect(timelineChoiceForAction('close_enquiry')).toBeNull();
    expect(timelineChoiceForAction('still_considering')).toBeNull();
    expect(timelineChoiceForAction(null)).toBeNull();
  });

  // The whole point of routing on the action: a lead sent the Kannada
  // template taps a Kannada label, and it has to mean the same thing.
  it('recognises the tap in every language we send the template in', () => {
    for (const choice of TIMELINE_CHOICES) {
      const action = timelineButtonAction(choice);
      for (const language of LANGUAGE_CODES) {
        const label = templateButtonLabel(action, language);
        expect(
          timelineChoiceForAction(matchTemplateButton(label)),
          `${choice} / ${language}`
        ).toBe(choice);
      }
    }
  });
});

describe('buildTimelineAskParams', () => {
  it('greets by first name and signs with the brokerage', () => {
    expect(
      buildTimelineAskParams(
        'Surya Bajaj',
        'Aryavarta Ventures',
        '3 acres in Sarjapur'
      )
    ).toEqual(['Surya', 'Aryavarta Ventures', '3 acres in Sarjapur']);
  });

  it('never greets a placeholder lead name, and never sends unsigned', () => {
    const [name, brand] = buildTimelineAskParams(
      'Housing Lead',
      '  ',
      'A listing'
    );
    expect(name).toBe('there');
    expect(brand.length).toBeGreaterThan(0);
  });

  it('falls back rather than sending an empty param', () => {
    expect(buildTimelineAskParams(null, 'Acme', '   ')[2]).toBe('your enquiry');
  });
});
