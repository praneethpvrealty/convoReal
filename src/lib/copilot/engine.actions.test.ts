import { beforeEach, describe, expect, it, vi } from 'vitest';

const { embedText, generateJson } = vi.hoisted(() => ({
  embedText: vi.fn(),
  generateJson: vi.fn(),
}));

vi.mock('@/lib/ai/gemini', () => ({ embedText, generateJson }));

import { answerQuestion } from './engine';

const event = {
  kind: 'event' as const,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'JP Nagar property visit',
};

const property = {
  kind: 'property' as const,
  id: '22222222-2222-4222-8222-222222222222',
  label: 'JP Nagar Plot',
};

beforeEach(() => {
  embedText.mockReset();
  generateJson.mockReset();
});

describe('Copilot confirmed action integration', () => {
  it.each(['web', 'mobile'] as const)(
    'answers the reported audience-sharing question on %s without an add tour',
    async (platform) => {
      const answer = await answerQuestion({
        audience: 'agent',
        message:
          'I need to send Property details of a freshly added property to audience of an existing property. How can I do it?',
        pathname: '/inbox',
        history: [],
        accountId: 'account-1',
        platform,
      });

      expect(answer.reply).toContain('Listing audience');
      expect(answer.reply).toContain('enquired');
      expect(answer.reply).toContain('Nothing is sent automatically');
      expect(answer.reply).toContain('Web: Inventory');
      expect(answer.reply).toContain('Mobile app: Properties');
      expect(answer.tourId).toBeUndefined();
      expect(answer.action).toBeUndefined();
      expect(answer.links).toEqual(
        platform === 'mobile'
          ? [{ label: 'Open in mobile app', navigateTo: '/inventory' }]
          : [
              { label: 'Open on web', navigateTo: '/inventory' },
              {
                label: 'Open in mobile app',
                appUrl: 'convoreal:///properties',
              },
            ]
      );
      expect(answer.webUrl).toBeUndefined();
      expect(answer.coverage).toBe(platform === 'mobile' ? 'full' : undefined);
      expect(embedText).not.toHaveBeenCalled();
      expect(generateJson).not.toHaveBeenCalled();
    }
  );

  it.each([
    'Share the new property with people who enquired about the old listing',
    'Send #JP Nagar Plot to the audience of #Indiranagar Flat',
    'How can I forward the property to contacts who viewed another listing?',
  ])('keeps audience selection in the composer for "%s"', async (message) => {
    const answer = await answerQuestion({
      audience: 'agent',
      message,
      pathname: '/inventory',
      history: [],
      accountId: 'account-1',
      entities: [
        property,
        { ...property, id: event.id, label: 'Indiranagar Flat' },
      ],
      canExecuteActions: true,
    });
    expect(answer.reply).toContain('Choose the existing listing');
    expect(answer.action).toBeUndefined();
    expect(answer.navigateTo).toBeUndefined();
    expect(answer.links).toEqual([
      { label: 'Open on web', navigateTo: '/inventory' },
      { label: 'Open in mobile app', appUrl: 'convoreal:///properties' },
    ]);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('links a named property directly to audience sharing', async () => {
    const answer = await answerQuestion({
      audience: 'agent',
      message: 'Find the right audience for PROP-1633 and share the details',
      pathname: '/inventory',
      history: [],
      accountId: 'account-1',
      platform: 'mobile',
      entities: [{ ...property, label: 'PROP-1633 — JP Nagar Plot' }],
      canExecuteActions: true,
    });

    expect(answer.links).toEqual([
      {
        label: 'Open in mobile app',
        navigateTo: `/inventory?sharePropertyId=${property.id}&shareAudience=1`,
      },
    ]);
    expect(answer.reply).toContain(
      'Mobile app: Properties → PROP-1633 → Matching Contacts'
    );
    expect(answer.coverage).toBe('full');
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('offers separate web and app links for a named property on web', async () => {
    const answer = await answerQuestion({
      audience: 'agent',
      message: 'Find the right audience for PROP-1633 and share the details',
      pathname: '/inventory',
      history: [],
      accountId: 'account-1',
      entities: [{ ...property, label: 'PROP-1633 — JP Nagar Plot' }],
      canExecuteActions: true,
    });

    expect(answer.links).toEqual([
      {
        label: 'Open on web',
        navigateTo: `/inventory?sharePropertyId=${property.id}&shareAudience=1`,
      },
      {
        label: 'Open in mobile app',
        appUrl: `convoreal:///property/${property.id}?audience=1`,
      },
    ]);
  });

  it('does not offer a sharing link to a view-only member', async () => {
    const answer = await answerQuestion({
      audience: 'agent',
      message: 'Share PROP-1633 with a listing audience',
      pathname: '/inventory',
      history: [],
      accountId: 'account-1',
      canExecuteActions: false,
      entities: [{ ...property, label: 'PROP-1633 — JP Nagar Plot' }],
    });

    expect(answer.reply).toContain('view-only access');
    expect(answer.links).toBeUndefined();
  });

  it('creates a mobile confirmation without invoking the model', async () => {
    const answer = await answerQuestion({
      audience: 'agent',
      message: 'Mark &JP Nagar property visit completed',
      pathname: '/calendar',
      history: [],
      accountId: 'account-1',
      platform: 'mobile',
      entities: [event],
      canExecuteActions: true,
    });

    expect(answer).toMatchObject({
      coverage: 'full',
      action: {
        type: 'complete_event',
        entity: event,
      },
    });
    expect(answer.action?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(embedText).not.toHaveBeenCalled();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('keeps the same request view-only for a viewer', async () => {
    const answer = await answerQuestion({
      audience: 'agent',
      message: 'Mark &JP Nagar property visit completed',
      pathname: '/calendar',
      history: [],
      accountId: 'account-1',
      entities: [event],
      canExecuteActions: false,
    });

    expect(answer.action).toBeUndefined();
    expect(answer.reply).toContain('view-only access');
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('prepares sharing instead of auto-opening the generic property view', async () => {
    const answer = await answerQuestion({
      audience: 'agent',
      message: 'Open/share #JP Nagar Plot',
      pathname: '/inventory',
      history: [],
      accountId: 'account-1',
      entities: [property],
      canExecuteActions: true,
    });

    expect(answer.navigateTo).toBeUndefined();
    expect(answer.action).toMatchObject({
      type: 'share_property',
      entity: property,
    });
    expect(generateJson).not.toHaveBeenCalled();
  });
});
