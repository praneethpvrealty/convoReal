import { describe, expect, it } from 'vitest';
import { SPEC_DEFAULT_STAGES } from './default-stages';
import { buildStageMessage, stageMessageIntent } from './stage-message';

describe('stage message', () => {
  it('[PIPE-006] gives every default stage its own next-step message', () => {
    expect(
      SPEC_DEFAULT_STAGES.map((stage) => stageMessageIntent(stage))
    ).toEqual([
      'arrange_visit',
      'confirm_visit',
      'owner_meeting',
      'negotiation',
      'due_diligence',
      'agreement',
      'brokerage',
      'closed',
      'reengage',
    ]);
  });

  it('[PIPE-006] asks an enquiry whether to arrange a site visit', () => {
    const { message, title } = buildStageMessage({
      stage: { name: 'Enquiry → Shortlist', stage_type: 'open' },
      contactName: 'Anil Reddy',
      propertyTitle: 'KHB Plot in Suryanagar',
      propertyCode: 'PROP-12',
    });
    expect(title).toBe('Offer a site visit');
    expect(message).toBe(
      "Hi Anil, hope you had a chance to look at KHB Plot in Suryanagar (PROP-12). Would you like me to arrange a site visit? Let me know a day and time that suits you and I'll set it up."
    );
  });

  it('[PIPE-006] reads a renamed stage by its stored type and next step', () => {
    expect(stageMessageIntent({ name: 'Site visit', stage_type: 'open' })).toBe(
      'confirm_visit'
    );
    expect(stageMessageIntent({ name: 'Dropped', stage_type: 'lost' })).toBe(
      'reengage'
    );
    expect(stageMessageIntent('Something custom')).toBe('check_in');
    expect(stageMessageIntent(null)).toBe('check_in');
  });

  it('[PIPE-006] appends the showcase link and falls back without names', () => {
    const { message } = buildStageMessage({
      stage: 'Shortlisted → Visit',
      contactName: ' ',
      propertyUrl: 'https://example.com/p/1',
    });
    expect(message.startsWith("Hi, let's fix your site visit")).toBe(true);
    expect(message).toContain('the property');
    expect(
      message.endsWith('📸 Photos & full details:\nhttps://example.com/p/1')
    ).toBe(true);
  });

  it('[PIPE-006] leaves the link off the brokerage and thank-you notes', () => {
    const { message } = buildStageMessage({
      stage: { name: 'Brokerage paid / Closed', stage_type: 'brokerage_paid' },
      propertyTitle: 'Villa',
      propertyUrl: 'https://example.com/p/1',
    });
    expect(message).not.toContain('https://');
  });
});
