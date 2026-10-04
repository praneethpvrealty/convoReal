import { beforeEach, describe, expect, it, vi } from 'vitest';

const { embedText, generateJson, hasGeminiKey } = vi.hoisted(() => ({
  embedText: vi.fn(),
  generateJson: vi.fn(),
  hasGeminiKey: vi.fn(),
}));

vi.mock('@/lib/ai/gemini', () => ({ embedText, generateJson }));
vi.mock('@/lib/ai/gemini-keys', () => ({ hasGeminiKey }));

import { answerQuestion } from './engine';
import type { ContactSearchQuery } from './contact-search';

const QUESTION = 'Contact who is looking for residential property in JP Nagar';

const praveen = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Praveen',
  classification: 'Buyer',
  budgetMin: 20_000_000,
  budgetMax: 50_000_000,
  matchedArea: 'JP Nagar',
};

beforeEach(() => {
  embedText.mockReset();
  generateJson.mockReset();
  hasGeminiKey.mockReset().mockResolvedValue(true);
});

describe('Copilot contact search intent', () => {
  it.each(['web', 'mobile'] as const)(
    '[CPL-003] answers the reported question with contact-card links on %s, without a tour or a model call',
    async (platform) => {
      const contactSearch = vi
        .fn()
        .mockResolvedValue({ total: 3, matches: [praveen] });

      const answer = await answerQuestion({
        audience: 'agent',
        message: QUESTION,
        pathname: '/contacts',
        history: [],
        accountId: 'account-1',
        platform,
        contactSearch,
      });

      const query = contactSearch.mock.calls[0][0] as ContactSearchQuery;
      expect(query.areas).toEqual(['JP Nagar']);
      expect(query.categories).toEqual(['residential']);
      expect(answer.tourId).toBeUndefined();
      expect(answer.cached).toBeUndefined();
      expect(answer.reply).toContain(
        '3 contacts are looking for residential in JP Nagar'
      );
      expect(answer.links).toEqual([
        {
          label: 'Praveen',
          subtitle: 'Buyer · ₹2 Cr–₹5 Cr · JP Nagar',
          navigateTo: `/contacts?contactId=${praveen.id}`,
        },
        {
          label: 'See all 3 in Contacts',
          navigateTo: '/contacts?search=JP%20Nagar%20residential',
        },
      ]);
      expect(answer.coverage).toBe(platform === 'mobile' ? 'full' : undefined);
      expect(generateJson).not.toHaveBeenCalled();
      expect(embedText).not.toHaveBeenCalled();
    }
  );

  it('[CPL-003] stays on the generic path when no contact search is wired', async () => {
    hasGeminiKey.mockResolvedValue(false);
    const answer = await answerQuestion({
      audience: 'agent',
      message: QUESTION,
      pathname: '/contacts',
      history: [],
      accountId: 'account-1',
    });
    expect(answer.links).toBeUndefined();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('asks for criteria instead of searching blind', async () => {
    hasGeminiKey.mockResolvedValue(false);
    const contactSearch = vi.fn();
    const answer = await answerQuestion({
      audience: 'agent',
      message: 'which contacts are looking?',
      pathname: '/dashboard',
      history: [],
      accountId: 'account-1',
      contactSearch,
    });
    expect(contactSearch).not.toHaveBeenCalled();
    expect(answer.reply).toContain('Tell me what to look for');
  });

  it('uses the preference extractor for phrasing the parser cannot read', async () => {
    generateJson.mockResolvedValue(
      JSON.stringify({
        property_types: ['Villa'],
        property_categories: ['residential'],
        areas: ['Whitefield'],
        budget_max: 30000000,
      })
    );
    const contactSearch = vi.fn().mockResolvedValue({ total: 0, matches: [] });

    const answer = await answerQuestion({
      audience: 'agent',
      message: 'koi client hai jisko Whitefield side ghar chahiye',
      pathname: '/contacts',
      history: [],
      accountId: 'account-1',
      contactSearch,
    });

    expect(generateJson).toHaveBeenCalledTimes(1);
    const query = contactSearch.mock.calls[0][0] as ContactSearchQuery;
    expect(query.areas).toEqual(['Whitefield']);
    expect(query.propertyTypes).toEqual(['Villa']);
    expect(query.budgetMax).toBe(30_000_000);
    expect(answer.reply).toMatch(
      /^No contacts are looking for Villa in Whitefield/
    );
    expect(answer.links).toEqual([
      {
        label: 'Open Contacts',
        navigateTo: '/contacts?search=Whitefield%20Villa',
      },
    ]);
  });

  it('reports a failed lookup honestly rather than inventing contacts', async () => {
    const contactSearch = vi.fn().mockRejectedValue(new Error('rpc missing'));
    const answer = await answerQuestion({
      audience: 'agent',
      message: QUESTION,
      pathname: '/contacts',
      history: [],
      accountId: 'account-1',
      contactSearch,
    });
    expect(answer.reply).toContain('could not search your contacts');
    expect(answer.links).toEqual([
      { label: 'Open Contacts', navigateTo: '/contacts' },
    ]);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('never offers contact search to the owner or buyer portals', async () => {
    hasGeminiKey.mockResolvedValue(false);
    const contactSearch = vi.fn();
    for (const audience of ['owner', 'buyer'] as const) {
      await answerQuestion({
        audience,
        message: QUESTION,
        pathname: '/den',
        history: [],
        accountId: 'account-1',
        contactSearch,
      });
    }
    expect(contactSearch).not.toHaveBeenCalled();
  });
});
