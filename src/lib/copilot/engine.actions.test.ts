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
