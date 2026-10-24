import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadTypeSuggestions = vi.fn();

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ supabase: {}, accountId: 'acc-1' }),
  toErrorResponse: (err: Error) =>
    Response.json({ error: err.message }, { status: 500 }),
}));
vi.mock('@/lib/inventory/match-feedback-store', () => ({
  loadTypeSuggestions: (...args: unknown[]) => loadTypeSuggestions(...args),
}));

const { POST } = await import('./route');

const ID = '22222222-2222-4222-8222-222222222222';

function post(body: unknown) {
  return POST(
    new Request('http://x', { method: 'POST', body: JSON.stringify(body) })
  );
}

beforeEach(() => {
  loadTypeSuggestions.mockReset();
  loadTypeSuggestions.mockResolvedValue({ [ID]: 'pt_plot' });
});

describe('[PRP-051] POST /api/contacts/type-suggestions', () => {
  it("returns suggestions for the caller's account", async () => {
    const res = await post({ contactIds: [ID] });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ [ID]: 'pt_plot' });
    expect(loadTypeSuggestions).toHaveBeenCalledWith({}, 'acc-1', [ID]);
  });

  it('refuses a missing list, a bad id or more than the cap', async () => {
    for (const body of [
      {},
      { contactIds: 'x' },
      { contactIds: ['not-a-uuid'] },
      { contactIds: Array.from({ length: 101 }, () => ID) },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(loadTypeSuggestions).not.toHaveBeenCalled();
  });
});
