import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc }),
}));

import type { AccountContext } from '@/lib/auth/account';
import { listRegisteredAgentContacts } from './agent-account-share';

function contextWith(rows: unknown[]) {
  const filters: [string, unknown][] = [];
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    not: () => query,
    order: () => query,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return {
    filters,
    ctx: {
      accountId: 'account-a',
      userId: 'user-a',
      supabase: { from: () => query },
    } as unknown as AccountContext,
  };
}

const agents = [
  { id: 'c1', name: 'Aakash', phone: '+91 91636 36563', company: null },
  { id: 'c2', name: 'Dhruv', phone: '919360165563', company: 'Jade' },
  { id: 'c3', name: 'Colleague', phone: '9880080211', company: null },
  { id: 'c4', name: 'Short', phone: '12345', company: null },
];

describe('[REQ-007] agents offered for an in-app requirement share', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only saved agents whose number belongs to another account', async () => {
    rpc.mockResolvedValue({
      data: [
        { phone_last10: '9163636563', user_id: 'u1', account_id: 'account-b' },
        { phone_last10: '9880080211', user_id: 'u2', account_id: 'account-a' },
      ],
      error: null,
    });
    const { ctx, filters } = contextWith(agents);

    await expect(listRegisteredAgentContacts(ctx)).resolves.toEqual([
      agents[0],
    ]);
    expect(filters).toEqual([
      ['account_id', 'account-a'],
      ['classification', 'Agent'],
      ['is_merged', false],
    ]);
    expect(rpc).toHaveBeenCalledWith('find_agent_profile_accounts_batch', {
      p_phone_last10s: ['9163636563', '9360165563', '9880080211'],
    });
  });

  it('asks nothing of the directory when no agent has a full number', async () => {
    const { ctx } = contextWith([agents[3]]);
    await expect(listRegisteredAgentContacts(ctx)).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
