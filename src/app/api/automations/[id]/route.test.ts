import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ userId: 'u1', role: 'agent' }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 401 }),
}));

vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: async () => [
    { step_type: 'send_message', step_config: { text: 'Hello' } },
  ],
  replaceSteps: async () => null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: state.existing, error: null }),
        update: (patch: Record<string, unknown>) => {
          state.updates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
      return builder;
    },
  }),
}));

import { PATCH } from './route';

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request('http://test/api/automations/a1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'a1' }) }
  );
}

beforeEach(() => {
  state.updates = [];
  state.existing = {
    id: 'a1',
    user_id: 'u1',
    is_active: false,
    trigger_type: 'tag_added',
    trigger_config: { tag_id: 'tag-1' },
  };
});

describe('PATCH /api/automations/[id]', () => {
  it.each(['conversation_assigned', 'tag_added', 'time_based'])(
    'refuses to turn on an automation with the unavailable %s trigger',
    async (trigger) => {
      state.existing = { ...state.existing, trigger_type: trigger };
      const res = await patch({ is_active: true });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0].path).toBe('trigger.type');
      expect(body.issues[0].message).toContain(trigger);
      expect(state.updates).toEqual([]);
    }
  );

  it('still saves an unavailable-trigger automation while it stays paused', async () => {
    const res = await patch({ name: 'Renamed', is_active: false });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ name: 'Renamed', is_active: false }]);
  });

  it('turns on an automation whose trigger is available', async () => {
    state.existing = {
      ...state.existing,
      trigger_type: 'new_contact_created',
      trigger_config: {},
    };
    const res = await patch({ is_active: true });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ is_active: true }]);
  });
});
