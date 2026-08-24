import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, syncAgentSourceInventory } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  syncAgentSourceInventory: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/agents/source-inventory-sync', () => ({
  syncAgentSourceInventory,
}));

import { POST } from './route';

describe('POST /api/agents/inventory-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({
      accountId: 'agent-b-account',
      userId: 'agent-b-user',
      role: 'agent',
      supabase: {},
    });
  });

  it('requires an agent and returns the imported inventory count', async () => {
    syncAgentSourceInventory.mockResolvedValue({ imported: 2, matched: 3 });

    const response = await POST();

    expect(requireRole).toHaveBeenCalledWith('agent');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { imported: 2, matched: 3 },
    });
  });
});
