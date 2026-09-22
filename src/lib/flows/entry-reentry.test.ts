import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Entry is decided per flow. A lead sent a listing who then asks about
 * it must not have the funnel they already went through restarted on a
 * keyword buried in the question — while a flow they have never seen
 * still opens on its own keyword.
 */

interface FlowRow {
  id: string;
  account_id: string;
  status: string;
  name: string;
  trigger_type: string;
  trigger_config: { keywords: string[]; match_type?: string };
  entry_node_id: string | null;
  created_at: string;
}

let flows: FlowRow[] = [];
let priorRunFlowIds: string[] = [];
/** Flow ids hasRunBefore was asked about. */
let reentryChecks: string[] = [];
/** Set once a flow was selected and the engine went to load its nodes. */
let nodesLoadedFor: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db }));

const db = {
  rpc: () => Promise.resolve({ error: null }),
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let inserted = false;
    const builder: Record<string, unknown> = {};
    const resolve = () => {
      if (table === 'flows') return { data: flows, error: null };
      if (table === 'flow_nodes') {
        nodesLoadedFor.push(String(filters.flow_id ?? ''));
        return { data: [], error: null };
      }
      if (table === 'flow_runs') {
        // loadActiveRunForContact asks for status='active'; nothing is
        // active here. hasRunBefore asks by flow_id.
        if (filters.status === 'active') return { data: [], error: null };
        // hasRunBefore is the only flow_runs read keyed by flow_id;
        // run updates and inserts carry none.
        if (filters.flow_id === undefined) return { data: [], error: null };
        const flowId = String(filters.flow_id);
        reentryChecks.push(flowId);
        return {
          data: priorRunFlowIds.includes(flowId) ? [{ id: 'run-1' }] : [],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    Object.assign(builder, {
      select: () => builder,
      insert: () => {
        inserted = true;
        return builder;
      },
      update: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      is: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () =>
        Promise.resolve({
          data:
            inserted && table === 'flow_runs'
              ? { id: 'run-new', account_id: 'acct-1', vars: {} }
              : null,
          error: null,
        }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (r: (v: { data: unknown; error: null }) => unknown) => r(resolve()),
    });
    return builder;
  },
};

vi.mock('./engine-send', () => ({}));

const { dispatchInboundToFlows } = await import('./engine');

function flow(over: Partial<FlowRow>): FlowRow {
  return {
    id: 'flow-showcase',
    account_id: 'acct-1',
    status: 'active',
    name: 'Real Estate Showcase',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['hi', 'buy', 'rent', 'properties'] },
    entry_node_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

// The reported message, verbatim.
const TENANT_QUESTIONS = [
  'Please send me the following details..',
  '1.How old is this building?',
  '2.Who are the tenants and rent received per tenant??',
  '3.Number of Floors',
  '4.tenure of the lease agreements with tenant',
].join('\n');

async function dispatch(text: string, repliesRatherThanOpens: boolean) {
  return dispatchInboundToFlows({
    accountId: 'acct-1',
    userId: 'user-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    allowEntry: true,
    repliesRatherThanOpens,
    message: { kind: 'text', text, meta_message_id: 'wamid.1' },
    isFirstInboundMessage: false,
  });
}

beforeEach(() => {
  flows = [];
  priorRunFlowIds = [];
  reentryChecks = [];
  nodesLoadedFor = [];
});

describe('[INB-011] keyword entry for a message that replies rather than opens', () => {
  it('does not restart a flow this lead has already been through', async () => {
    flows = [flow({})];
    priorRunFlowIds = ['flow-showcase'];

    const result = await dispatch(TENANT_QUESTIONS, true);

    // `rent` matched, so the flow was weighed and skipped: the engine
    // never went on to load its nodes.
    expect(reentryChecks).toEqual(['flow-showcase']);
    expect(nodesLoadedFor).toEqual([]);
    expect(result.consumed).toBe(false);
    expect(result.outcome).toBe('no_match');
  });

  it('still opens a flow this lead has never seen', async () => {
    // Codex's case: an FAQ flow keyed on "question"/"info" must keep
    // firing for a shared lead who asks for it.
    flows = [
      flow({
        id: 'flow-faq',
        name: 'FAQ bot',
        trigger_config: { keywords: ['faq', 'question', 'info'] },
        entry_node_id: 'start',
      }),
    ];
    priorRunFlowIds = [];

    await dispatch('Can I get FAQ info?', true);

    // Weighed, then selected: loading its nodes is the step a skip
    // never reaches.
    expect(reentryChecks).toEqual(['flow-faq']);
    expect(nodesLoadedFor).toEqual(['flow-faq']);
  });

  it('leaves an opener alone even for a flow this lead has run', async () => {
    flows = [flow({ entry_node_id: 'start' })];
    priorRunFlowIds = ['flow-showcase'];

    await dispatch('hi', false);

    // Not a reply, so the ledger is never consulted and the flow opens.
    expect(reentryChecks).toEqual([]);
    expect(nodesLoadedFor).toEqual(['flow-showcase']);
  });
});
