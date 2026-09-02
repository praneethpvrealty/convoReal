import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api', () => ({ apiFetch }));

import { appHrefForWebRoute, executeCopilotAction } from './copilot';

const action = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'complete_event' as const,
  entity: {
    kind: 'event' as const,
    id: '11111111-1111-4111-8111-111111111111',
    label: 'JP Nagar visit',
  },
  title: 'Complete event?',
  description: 'Changes the status.',
  confirmLabel: 'Mark completed',
};

beforeEach(() => apiFetch.mockReset());

describe('mobile Copilot actions', () => {
  it('maps a confirmed property handoff to the native share screen', () => {
    expect(
      appHrefForWebRoute(
        '/inventory?sharePropertyId=22222222-2222-4222-8222-222222222222&copilotAction=33333333-3333-4333-8333-333333333333'
      )
    ).toBe(
      '/(app)/property/22222222-2222-4222-8222-222222222222?share=33333333-3333-4333-8333-333333333333'
    );
  });

  it('executes completion through the shared authenticated API', async () => {
    const result = {
      actionId: action.id,
      type: 'complete_event' as const,
      entityId: action.entity.id,
      status: 'completed' as const,
      outcome: 'applied' as const,
      replayed: false,
      executedAt: '2026-09-02T09:00:00Z',
    };
    apiFetch.mockResolvedValue({ data: result });

    await expect(executeCopilotAction(action)).resolves.toEqual(result);
    expect(apiFetch).toHaveBeenCalledWith('/api/copilot/actions', {
      method: 'POST',
      body: JSON.stringify({
        actionId: action.id,
        type: action.type,
        entityId: action.entity.id,
        platform: 'mobile',
      }),
    });
  });
});
