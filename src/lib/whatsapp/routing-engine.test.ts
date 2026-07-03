import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Generic fake Postgrest builder: one `info` object per query
// chain, mutated in place by every .eq()/.not()/.order() call and
// read back by the terminal method (.maybeSingle() or the implicit
// await via .then()). Resolves via a per-test `resolver(info)`
// callback, so each test expresses "what should this specific
// query return" without a giant shared mock.
// ============================================================

type QueryInfo = {
  table: string;
  filters: Record<string, unknown>;
  notNullColumns: string[];
  isCount: boolean;
};

let resolver: (info: QueryInfo) => { data: unknown; error: unknown; count?: number };

function makeBuilder(table: string, isCount: boolean) {
  const info: QueryInfo = { table, filters: {}, notNullColumns: [], isCount };
  const builder: Record<string, unknown> = {
    eq: vi.fn((col: string, val: unknown) => {
      info.filters[col] = val;
      return builder;
    }),
    not: vi.fn((col: string) => {
      info.notNullColumns.push(col);
      return builder;
    }),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(resolver(info))),
    then: (resolve: (v: { data: unknown; error: unknown; count?: number }) => unknown) =>
      Promise.resolve(resolver(info)).then(resolve),
  };
  return builder;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn((_selectArg: string, opts?: { count?: string; head?: boolean }) =>
        makeBuilder(table, Boolean(opts?.count)),
      ),
    })),
  })),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

const { resolveRouting } = await import('./routing-engine');

describe('resolveRouting', () => {
  beforeEach(() => {
    resolver = () => ({ data: null, error: null });
  });

  it("rule 2: routes to the contact's explicitly assigned agent when still a valid account member", async () => {
    resolver = (info) => {
      if (info.table === 'profiles' && info.filters.user_id === 'agent-1') {
        return { data: { account_id: 'acc-1', team_id: 'team-1' }, error: null };
      }
      return { data: null, error: null };
    };

    const result = await resolveRouting({
      accountId: 'acc-1',
      phone: '911234567890',
      messageText: 'hi',
      contactId: 'contact-1',
      contactAssignedAgentId: 'agent-1',
    });

    expect(result).toEqual({
      agentId: 'agent-1',
      teamId: 'team-1',
      ruleUsed: 'explicit',
      requiresManualAssignment: false,
    });
  });

  it('rule 2: falls through to later rules when the explicitly assigned agent no longer belongs to the account', async () => {
    resolver = (info) => {
      if (info.table === 'profiles' && info.filters.user_id === 'stale-agent') {
        // Agent moved to a different account — invalid.
        return { data: { account_id: 'other-acc', team_id: null }, error: null };
      }
      if (info.table === 'routing_rules') return { data: [], error: null };
      if (info.table === 'profiles') return { data: [], error: null };
      return { data: null, error: null };
    };

    const result = await resolveRouting({
      accountId: 'acc-1',
      phone: '911234567890',
      messageText: 'no keywords here',
      contactId: 'contact-1',
      contactAssignedAgentId: 'stale-agent',
    });

    expect(result.ruleUsed).toBe('leader_queue');
    expect(result.requiresManualAssignment).toBe(true);
  });

  it('rule 3: routes via a locality_match routing_rules row matching the inbound text', async () => {
    resolver = (info) => {
      if (info.table === 'routing_rules') {
        return {
          data: [
            { id: 'r1', rule_type: 'locality_match', match_value: 'whitefield', target_team_id: null, target_agent_id: 'agent-2', priority: 100 },
          ],
          error: null,
        };
      }
      if (info.table === 'profiles' && info.filters.user_id === 'agent-2') {
        return { data: { account_id: 'acc-1', team_id: 'team-2' }, error: null };
      }
      return { data: null, error: null };
    };

    const result = await resolveRouting({
      accountId: 'acc-1',
      phone: '911234567890',
      messageText: 'Looking for a 3BHK in Whitefield please',
      contactId: 'contact-1',
    });

    expect(result).toEqual({
      agentId: 'agent-2',
      teamId: 'team-2',
      ruleUsed: 'locality',
      requiresManualAssignment: false,
    });
  });

  it("rule 3: falls back to an agent's own coverage_areas when no routing_rules row matches", async () => {
    resolver = (info) => {
      if (info.table === 'routing_rules') return { data: [], error: null };
      if (info.table === 'profiles' && info.notNullColumns.includes('coverage_areas')) {
        return {
          data: [{ user_id: 'agent-3', team_id: 'team-3', coverage_areas: ['HSR Layout', 'Koramangala'] }],
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const result = await resolveRouting({
      accountId: 'acc-1',
      phone: '911234567890',
      messageText: 'Any 2BHK in HSR Layout?',
      contactId: 'contact-1',
    });

    expect(result).toEqual({
      agentId: 'agent-3',
      teamId: 'team-3',
      ruleUsed: 'locality',
      requiresManualAssignment: false,
    });
  });

  it('rule 4: routes via a source_match routing_rules row when locality yields nothing', async () => {
    resolver = (info) => {
      if (info.table === 'routing_rules') {
        return {
          data: [
            { id: 'r2', rule_type: 'source_match', match_value: 'MagicBricks', target_team_id: 'team-4', target_agent_id: null, priority: 100 },
          ],
          error: null,
        };
      }
      if (info.table === 'profiles') return { data: [], error: null };
      return { data: null, error: null };
    };

    const result = await resolveRouting({
      accountId: 'acc-1',
      phone: '911234567890',
      messageText: 'no locality keywords',
      contactId: 'contact-1',
      source: 'MagicBricks',
    });

    expect(result).toEqual({
      agentId: null,
      teamId: 'team-4',
      ruleUsed: 'source',
      requiresManualAssignment: false,
    });
  });

  it('rule 5: round-robins to the least-loaded available agent in the fallback team', async () => {
    resolver = (info) => {
      if (info.table === 'routing_rules') {
        return {
          data: [{ id: 'r3', rule_type: 'fallback', match_value: null, target_team_id: 'team-5', target_agent_id: null, priority: 999 }],
          error: null,
        };
      }
      if (info.table === 'profiles' && info.filters.team_id === 'team-5') {
        return { data: [{ user_id: 'busy-agent' }, { user_id: 'free-agent' }], error: null };
      }
      if (info.table === 'conversations') {
        // busy-agent has 3 open conversations, free-agent has 0.
        const count = info.filters.assigned_agent_id === 'busy-agent' ? 3 : 0;
        return { data: null, error: null, count };
      }
      return { data: null, error: null };
    };

    const result = await resolveRouting({
      accountId: 'acc-1',
      phone: '911234567890',
      messageText: 'no keywords',
      contactId: 'contact-1',
    });

    expect(result.agentId).toBe('free-agent');
    expect(result.teamId).toBe('team-5');
    expect(result.ruleUsed).toBe('round_robin');
    expect(result.requiresManualAssignment).toBe(false);
  });

  it('rule 6: lands in the unassigned leader queue when nothing matches and there is no fallback rule', async () => {
    resolver = (info) => {
      if (info.table === 'routing_rules') return { data: [], error: null };
      if (info.table === 'profiles') return { data: [], error: null };
      return { data: null, error: null };
    };

    const result = await resolveRouting({
      accountId: 'acc-1',
      phone: '911234567890',
      messageText: 'totally unrelated text',
      contactId: 'contact-1',
    });

    expect(result).toEqual({
      agentId: null,
      teamId: null,
      ruleUsed: 'leader_queue',
      requiresManualAssignment: true,
    });
  });
});
