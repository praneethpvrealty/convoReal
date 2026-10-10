import { beforeEach, describe, expect, it, vi } from 'vitest';

const { embedText, generateJson, hasGeminiKey } = vi.hoisted(() => ({
  embedText: vi.fn(),
  generateJson: vi.fn(),
  hasGeminiKey: vi.fn(),
}));

vi.mock('@/lib/ai/gemini', () => ({ embedText, generateJson }));
vi.mock('@/lib/ai/gemini-keys', () => ({ hasGeminiKey }));

import { answerQuestion } from './engine';
import type { PropertyInterestQuery } from './property-interest';

const QUESTION =
  "List out all the buyers who had showed interest in Adithi's property";
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

const result = {
  properties: [
    {
      id: PROPERTY_ID,
      title: 'Prime Corner Commercial Plot for Sale',
      code: 'PROP-1023',
      ownerName: 'Adithi',
    },
  ],
  contacts: [],
  matches: [
    {
      propertyId: PROPERTY_ID,
      propertyTitle: 'Prime Corner Commercial Plot for Sale',
      propertyCode: 'PROP-1023',
      contactId: CONTACT_ID,
      label: 'Ramesh',
      classification: 'Buyer',
      enquired: true,
      viewsCount: 2,
      shortlisted: false,
      visited: false,
      liked: false,
      journeyStage: 'Shortlist',
      journeyStatus: 'dropped',
      lastAt: '2026-10-08T10:00:00Z',
    },
  ],
  total: 1,
};

beforeEach(() => {
  embedText.mockReset();
  generateJson.mockReset();
  hasGeminiKey.mockReset().mockResolvedValue(true);
});

describe('Copilot property interest intent', () => {
  it.each(['web', 'mobile'] as const)(
    '[CPL-004] answers the reported question from the listing’s interest on %s, ahead of the preference search and without a model call',
    async (platform) => {
      const propertyInterest = vi.fn().mockResolvedValue(result);
      const contactSearch = vi.fn();

      const answer = await answerQuestion({
        audience: 'agent',
        message: QUESTION,
        pathname: '/inbox',
        history: [],
        accountId: 'account-1',
        platform,
        contactSearch,
        propertyInterest,
      });

      const query = propertyInterest.mock.calls[0][0] as PropertyInterestQuery;
      expect(query.direction).toBe('contacts');
      expect(query.ownerName).toBe('Adithi');
      expect(contactSearch).not.toHaveBeenCalled();
      expect(answer.reply).toBe(
        [
          "1 contact showed interest in Prime Corner Commercial Plot for Sale (Adithi's listing):",
          '• Ramesh — Buyer · Enquired · 2 views · Dropped after Shortlist · 8 Oct',
          '',
          'Tap a name to open the contact.',
        ].join('\n')
      );
      expect(answer.links).toEqual([
        {
          label: 'Ramesh',
          subtitle: 'Buyer · Enquired · 2 views · Dropped after Shortlist',
          navigateTo: `/contacts?contactId=${CONTACT_ID}`,
        },
        {
          label: 'Open Prime Corner Commercial Plot for Sale',
          subtitle: 'PROP-1023',
          navigateTo: `/inventory?propertyId=${PROPERTY_ID}`,
        },
      ]);
      expect(answer.tourId).toBeUndefined();
      expect(answer.cached).toBeUndefined();
      expect(answer.coverage).toBe(platform === 'mobile' ? 'full' : undefined);
      expect(generateJson).not.toHaveBeenCalled();
      expect(embedText).not.toHaveBeenCalled();
    }
  );

  it('[CPL-004] uses a selected # property without looking anything up by name', async () => {
    const propertyInterest = vi.fn().mockResolvedValue(result);
    await answerQuestion({
      audience: 'agent',
      message: 'who enquired about #Prime Corner this week',
      pathname: '/inventory',
      history: [],
      accountId: 'account-1',
      entities: [{ kind: 'property', id: PROPERTY_ID, label: 'Prime Corner' }],
      propertyInterest,
    });
    const query = propertyInterest.mock.calls[0][0] as PropertyInterestQuery;
    expect(query.propertyIds).toEqual([PROPERTY_ID]);
    expect(query.signal).toBe('enquired');
    expect(query.sinceLabel).toBe('this week');
  });

  it('[CPL-004] falls back to the preference search when no interest lookup is wired', async () => {
    const contactSearch = vi.fn().mockResolvedValue({ total: 0, matches: [] });
    const answer = await answerQuestion({
      audience: 'agent',
      message: QUESTION,
      pathname: '/inbox',
      history: [],
      accountId: 'account-1',
      contactSearch,
    });
    expect(contactSearch).toHaveBeenCalled();
    expect(answer.reply).toContain('No contacts are looking for');
  });

  it('[CPL-004] degrades to a pointer at the listing audience when the lookup fails', async () => {
    const propertyInterest = vi.fn().mockRejectedValue(new Error('rpc down'));
    const answer = await answerQuestion({
      audience: 'agent',
      message: QUESTION,
      pathname: '/inbox',
      history: [],
      accountId: 'account-1',
      propertyInterest,
    });
    expect(answer.reply).toContain('Share → Listing audience');
    expect(answer.links).toEqual([
      { label: 'Open Inventory', navigateTo: '/inventory' },
    ]);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('[CPL-004] still hands a listing-audience share to the share intent', async () => {
    const propertyInterest = vi.fn();
    const answer = await answerQuestion({
      audience: 'agent',
      message:
        'share this new listing with the buyers who enquired about the old property',
      pathname: '/inventory',
      history: [],
      accountId: 'account-1',
      canExecuteActions: true,
      propertyInterest,
    });
    expect(propertyInterest).not.toHaveBeenCalled();
    expect(answer.reply).toContain('Listing audience');
  });
});
