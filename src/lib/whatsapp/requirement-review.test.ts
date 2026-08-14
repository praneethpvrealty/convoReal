import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const sendPropertyTypePrompt = vi.fn();
const sendBudgetBandPrompt = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/whatsapp/property-type-prompt', () => ({
  sendPropertyTypePrompt: (...args: unknown[]) =>
    sendPropertyTypePrompt(...args),
}));

vi.mock('@/lib/whatsapp/budget-band', () => ({
  sendBudgetBandPrompt: (...args: unknown[]) => sendBudgetBandPrompt(...args),
}));

const {
  buildRequirementSummary,
  sendRequirementReview,
  handleRequirementTweakReply,
} = await import('./requirement-review');

import type { Contact } from '@/types';

/**
 * "Nothing fits that yet" is a dead end when the lead cannot see what
 * *that* is — a stale brief silently filters every future alert.
 * These pin the playback: the summary reads as the lead's own words,
 * every field is one tap from correction, and confirming it is itself
 * an answer.
 */

const aryan = {
  id: 'c1',
  name: 'Aryan Verma',
  pref_property_types: ['Commercial Land'],
  pref_areas: ['Surya City Phase II', 'Surya City Phase 2', 'Bangalore'],
  pref_budget_max: 15_600_000,
  no_budget: false,
} as unknown as Contact;

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
});

describe('buildRequirementSummary', () => {
  it('plays back type, area and budget as one recognisable line', () => {
    const summary = buildRequirementSummary(aryan);
    expect(summary).toContain('Commercial Land');
    expect(summary).toContain('Surya City Phase II');
    expect(summary).toContain('₹1.56 Cr');
  });

  it('drops the city filler and case-duplicate localities', () => {
    // "Surya City Phase II, Surya City Phase 2, Bangalore" reads as a
    // database dump, not a brief a person recognises as their own.
    const summary = buildRequirementSummary(aryan)!;
    expect(summary).not.toContain('Bangalore');
    expect(summary.match(/Surya City/g)).toHaveLength(2);
  });

  it('says "no fixed budget" instead of hiding an answered rung', () => {
    const summary = buildRequirementSummary({
      ...aryan,
      pref_budget_max: null,
      no_budget: true,
    } as Contact);
    expect(summary).toContain('no fixed budget');
  });

  it('shows a BHK range when one is on file', () => {
    const summary = buildRequirementSummary({
      ...aryan,
      pref_bhk_min: 2,
      pref_bhk_max: 3,
    } as Contact);
    expect(summary).toContain('2–3 BHK');
  });

  it('shows the size band, so "lesser dimensions" is visibly on file', () => {
    const capped = buildRequirementSummary({
      ...aryan,
      pref_land_area_max_sqft: 3570,
    } as Contact);
    expect(capped).toContain('up to 3,570 sq.ft');

    const banded = buildRequirementSummary({
      ...aryan,
      pref_land_area_min_sqft: 1200,
      pref_land_area_max_sqft: 2400,
    } as Contact);
    expect(banded).toContain('1,200 sq.ft–2,400 sq.ft');

    const exact = buildRequirementSummary({
      ...aryan,
      pref_land_area_min_sqft: 1200,
      pref_land_area_max_sqft: 1200,
    } as Contact);
    expect(exact).toContain('1,200 sq.ft');
    expect(exact).not.toContain('–1,200');
  });

  it('returns null with nothing on file, so callers keep their fallback', () => {
    expect(buildRequirementSummary({ id: 'c1' } as Contact)).toBeNull();
  });
});

describe('sendRequirementReview', () => {
  it('sends the brief with one-tap corrections and the form as last resort', async () => {
    const sent = await sendRequirementReview({
      db: {} as never,
      accountId: 'acct-1',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv-1',
      contact: aryan,
    });

    expect(sent).toBe(true);
    const call = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      interactiveBody: string;
      interactiveSections: { rows: { id: string; title: string }[] }[];
    };
    expect(call.interactiveBody).toContain('Commercial Land');
    expect(call.interactiveBody).toContain('Aryan');
    const ids = call.interactiveSections[0].rows.map((r) => r.id);
    expect(ids).toEqual([
      'tw_ok',
      'tw_type',
      'tw_budget',
      'tw_area',
      'lfb_form',
    ]);
    for (const row of call.interactiveSections[0].rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
    }
  });

  it('declines to send when there is nothing on file to review', async () => {
    const sent = await sendRequirementReview({
      db: {} as never,
      accountId: 'acct-1',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv-1',
      contact: { id: 'c1' } as Contact,
    });
    expect(sent).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });
});

describe('handleRequirementTweakReply', () => {
  const base = {
    db: {} as never,
    accountId: 'acct-1',
    configOwnerUserId: 'owner-1',
    contactId: 'c1',
    conversationId: 'conv-1',
  };

  it('confirms a correct brief — a stale extraction becomes a confirmed one', async () => {
    const handled = await handleRequirementTweakReply({
      ...base,
      replyId: 'tw_ok',
    });
    expect(handled).toBe(true);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('locked in') })
    );
  });

  it('re-opens the type list on a type tweak', async () => {
    await handleRequirementTweakReply({ ...base, replyId: 'tw_type' });
    expect(sendPropertyTypePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1' })
    );
  });

  it('re-opens the budget bands on a budget tweak', async () => {
    await handleRequirementTweakReply({ ...base, replyId: 'tw_budget' });
    expect(sendBudgetBandPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1' })
    );
  });

  it('asks for areas as a typed answer the ladder parses', async () => {
    await handleRequirementTweakReply({ ...base, replyId: 'tw_area' });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Which areas'),
      })
    );
  });

  it('ignores ids it does not own, so other handlers still run', async () => {
    expect(
      await handleRequirementTweakReply({ ...base, replyId: 'tw_forged' })
    ).toBe(false);
  });
});
