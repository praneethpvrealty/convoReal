import { beforeEach, describe, expect, it, vi } from 'vitest';

const maybeSingle = vi.fn();
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle }) }),
      }),
    }),
  }),
}));

import { resolveChannels } from './preferences';

beforeEach(() => maybeSingle.mockReset());

describe('resolveChannels', () => {
  it('uses event defaults when no override exists', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await resolveChannels('acc', 'inbound_reply')).toEqual({
      inApp: true,
      push: true,
      whatsapp: false,
    });
    expect(await resolveChannels('acc', 'first_inbound_message')).toEqual({
      inApp: true,
      push: true,
      whatsapp: true,
    });
  });

  it('applies a saved override', async () => {
    maybeSingle.mockResolvedValue({ data: { app_enabled: false, whatsapp_enabled: true } });
    expect(await resolveChannels('acc', 'first_inbound_message')).toEqual({
      inApp: false,
      push: false,
      whatsapp: true,
    });
  });

  it('falls back to all-on for an unknown event', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await resolveChannels('acc', 'does-not-exist')).toEqual({
      inApp: true,
      push: true,
      whatsapp: true,
    });
  });
});
