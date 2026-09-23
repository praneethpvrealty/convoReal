import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Lease {
  holder: string;
  expiresAt: number;
  pending: string[];
}

let leases = new Map<string, Lease>();
let payloads = new Map<string, unknown>();
let failing = new Set<string>();
let messageResults: unknown[] = [];
let messageFilters: { method: string; args: unknown[] }[] = [];

const live = (lease?: Lease) => !!lease && lease.expiresAt > Date.now();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      await Promise.resolve();
      if (failing.has(fn)) return { data: null, error: { message: fn } };
      const key = args.p_conversation_id as string;
      const lease = leases.get(key);
      const ttl = (args.p_ttl_seconds as number) * 1000;
      const defer = () => {
        if (!lease || !live(lease)) return false;
        if (!lease.pending.includes(args.p_message_id as string)) {
          lease.pending.push(args.p_message_id as string);
        }
        return true;
      };
      switch (fn) {
        case 'claim_conversation_qualification_lease':
          if (live(lease)) return { data: false, error: null };
          leases.set(key, {
            holder: args.p_holder as string,
            expiresAt: Date.now() + ttl,
            pending: lease?.pending ?? [],
          });
          return { data: true, error: null };
        case 'renew_conversation_qualification_lease':
          if (!lease || lease.holder !== args.p_holder) {
            return { data: false, error: null };
          }
          lease.expiresAt = Date.now() + ttl;
          return { data: true, error: null };
        case 'defer_conversation_message': {
          const deferred = defer();
          if (deferred) {
            payloads.set(`${key}:${args.p_message_id}`, args.p_payload);
          }
          return { data: deferred, error: null };
        }
        case 'defer_conversation_qualification':
          return { data: defer(), error: null };
        case 'finish_conversation_qualification_lease': {
          if (!lease || lease.holder !== args.p_holder) {
            return { data: [], error: null };
          }
          const pending = lease.pending;
          if (pending.length > 0) {
            lease.pending = [];
            lease.expiresAt = Date.now() + ttl;
            return { data: pending, error: null };
          }
          leases.delete(key);
          return { data: [], error: null };
        }
      }
      return { data: null, error: { message: `unknown ${fn}` } };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'delete', 'limit']) {
        chain[m] = () => chain;
      }
      chain.eq = (column: string, value: unknown) => {
        filters[column] = value;
        messageFilters.push({ method: 'eq', args: [column, value] });
        return chain;
      };
      chain.or = (...args: unknown[]) => {
        messageFilters.push({ method: 'or', args });
        return chain;
      };
      chain.maybeSingle = async () => {
        if (table === 'messages') {
          return { data: messageResults.shift() ?? null, error: null };
        }
        const key = `${filters.conversation_id}:${filters.message_id}`;
        const payload = payloads.get(key);
        payloads.delete(key);
        return { data: payload ? { payload } : null, error: null };
      };
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'messages') {
          return Promise.resolve(
            resolve({ data: messageResults.shift() ?? [], error: null })
          );
        }
        const key = filters.conversation_id as string;
        if (leases.get(key)?.holder === filters.holder) leases.delete(key);
        return Promise.resolve(resolve({ error: null }));
      };
      return chain;
    },
  }),
}));

const { runSerializedInbound, isEarliestCustomerMessage } =
  await import('./serialized-inbound');

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Inbound {
  id: string;
  text: string;
}

function conversationState() {
  return {
    activeRun: null as { node: string; vars: Record<string, string> } | null,
    runsStarted: 0,
    tags: new Set<string>(),
    sends: [] as string[],
  };
}

function handlerChain(state: ReturnType<typeof conversationState>) {
  return async ({ text }: Inbound) => {
    const run = state.activeRun;
    await tick(10);
    if (!run) {
      state.runsStarted++;
      state.activeRun = { node: 'ask_budget', vars: {} };
      state.sends.push('flow: welcome, what is your budget?');
    } else if (run.node === 'ask_budget') {
      run.vars.budget = text;
      run.node = 'done';
      state.sends.push(`flow: noted ${text}`);
    }
    const welcomed = state.tags.has('welcomed');
    await tick(5);
    if (!welcomed) {
      state.tags.add('welcomed');
      state.sends.push('automation: welcome pack');
    }
  };
}

beforeEach(() => {
  leases = new Map();
  payloads = new Map();
  failing = new Set();
  messageResults = [];
  messageFilters = [];
});

describe('runSerializedInbound', () => {
  it('[INB-016] without the lease, two overlapping messages start two flow runs and send the automation twice', async () => {
    const state = conversationState();
    const chain = handlerChain(state);
    await Promise.all([
      chain({ id: 'wamid.1', text: 'Hi' }),
      chain({ id: 'wamid.2', text: '30 lakh' }),
    ]);
    expect(state.runsStarted).toBe(2);
    expect(
      state.sends.filter((s) => s === 'automation: welcome pack')
    ).toHaveLength(2);
  });

  it('[INB-016] runs flows and automations for overlapping messages of one conversation one at a time', async () => {
    const state = conversationState();
    const handle = handlerChain(state);
    const send = (payload: Inbound) =>
      runSerializedInbound({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        messageId: payload.id,
        payload,
        handle,
        handleWithoutPayload: async () => {},
        leaseOptions: { pollMs: 2 },
      });

    await Promise.all([
      send({ id: 'wamid.1', text: 'Hi' }),
      tick(2).then(() => send({ id: 'wamid.2', text: '30 lakh' })),
    ]);

    expect(state.runsStarted).toBe(1);
    expect(state.activeRun?.vars).toEqual({ budget: '30 lakh' });
    expect(state.sends).toEqual([
      'flow: welcome, what is your budget?',
      'automation: welcome pack',
      'flow: noted 30 lakh',
    ]);
    expect(leases.size).toBe(0);
  });

  it('[INB-016] reruns the whole chain for a deferred message exactly once, in the holder', async () => {
    const handled: [string, boolean][] = [];
    const withoutPayload = vi.fn(async () => {});
    const handle = async (payload: Inbound, info: { waited: boolean }) => {
      handled.push([payload.id, info.waited]);
      await tick(payload.id === 'wamid.1' ? 60 : 1);
    };
    const holder = runSerializedInbound({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      messageId: 'wamid.1',
      payload: { id: 'wamid.1', text: 'Hi' },
      handle,
      handleWithoutPayload: withoutPayload,
      leaseOptions: { pollMs: 2 },
    });
    await tick(5);
    await runSerializedInbound({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      messageId: 'wamid.2',
      payload: { id: 'wamid.2', text: '30 lakh' },
      handle,
      handleWithoutPayload: withoutPayload,
      leaseOptions: { pollMs: 2, waitMs: 10 },
    });

    expect(handled).toEqual([['wamid.1', false]]);

    await holder;
    expect(handled).toEqual([
      ['wamid.1', false],
      ['wamid.2', true],
    ]);
    expect(withoutPayload).not.toHaveBeenCalled();
    expect(payloads.size).toBe(0);
    expect(leases.size).toBe(0);
  });

  it('[INB-016] reruns a deferred message that carried no payload through the fallback once', async () => {
    failing.add('defer_conversation_message');
    const handled: string[] = [];
    const withoutPayload = vi.fn(async () => {});
    const handle = async (payload: Inbound) => {
      handled.push(payload.id);
      await tick(payload.id === 'wamid.1' ? 60 : 1);
    };
    const holder = runSerializedInbound({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      messageId: 'wamid.1',
      payload: { id: 'wamid.1', text: 'Hi' },
      handle,
      handleWithoutPayload: withoutPayload,
      leaseOptions: { pollMs: 2 },
    });
    await tick(5);
    await runSerializedInbound({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      messageId: 'wamid.2',
      payload: { id: 'wamid.2', text: 'Rent' },
      handle,
      handleWithoutPayload: withoutPayload,
      leaseOptions: { pollMs: 2, waitMs: 10 },
    });
    await holder;

    expect(handled).toEqual(['wamid.1']);
    expect(withoutPayload).toHaveBeenCalledTimes(1);
    expect(withoutPayload).toHaveBeenCalledWith('wamid.2');
  });

  it('[INB-016] runs different conversations in parallel', async () => {
    const events: string[] = [];
    const handle = async (payload: Inbound) => {
      events.push(`start ${payload.id}`);
      await tick(20);
      events.push(`end ${payload.id}`);
    };
    await Promise.all(
      ['conv-1', 'conv-2'].map((conversationId) =>
        runSerializedInbound({
          accountId: 'acct-1',
          conversationId,
          messageId: `wamid.${conversationId}`,
          payload: { id: `wamid.${conversationId}`, text: 'Hi' },
          handle,
          handleWithoutPayload: async () => {},
          leaseOptions: { pollMs: 2 },
        })
      )
    );
    expect(events.slice(0, 2)).toEqual([
      'start wamid.conv-1',
      'start wamid.conv-2',
    ]);
  });

  it('[INB-016] never runs the chain unlocked while another holder is live and the message cannot be deferred', async () => {
    leases.set('conv-1', {
      holder: 'other',
      expiresAt: Date.now() + 60_000,
      pending: [],
    });
    failing.add('defer_conversation_message');
    failing.add('defer_conversation_qualification');
    const handle = vi.fn(async () => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runSerializedInbound({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        messageId: 'wamid.2',
        payload: { id: 'wamid.2', text: 'Hi' },
        handle,
        handleWithoutPayload: handle,
        leaseOptions: { waitMs: 0, sleep: async () => {} },
      })
    ).resolves.toBeUndefined();

    expect(handle).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('handlers skipped for wamid.2'),
      expect.anything()
    );
    error.mockRestore();
  });
});

describe('isEarliestCustomerMessage', () => {
  it('[INB-016] lets only the earliest of two racing first messages count as the first inbound', async () => {
    messageResults = [{ ingest_seq: 8 }, [{ id: 'm-7' }]];
    await expect(isEarliestCustomerMessage('conv-1', 'wamid.2')).resolves.toBe(
      false
    );
    expect(messageFilters).toContainEqual({
      method: 'or',
      args: ['ingest_seq.lt.8,ingest_seq.is.null'],
    });

    messageResults = [{ ingest_seq: 7 }, []];
    await expect(isEarliestCustomerMessage('conv-1', 'wamid.1')).resolves.toBe(
      true
    );
  });

  it('keeps the message first when its ingestion order is unknown', async () => {
    messageResults = [null];
    await expect(isEarliestCustomerMessage('conv-1', 'wamid.1')).resolves.toBe(
      true
    );
  });
});

describe('webhook inbound chain', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
    'utf8'
  );
  const bodyOf = (signature: string) => {
    const start = source.indexOf(signature);
    const end = source.indexOf('\nasync function ', start + 1);
    return source.slice(start, end);
  };

  it('[INB-016] runs every inbound handler, qualification included, inside one conversation lease', () => {
    const prelude = bodyOf('async function processMessage(');
    const chain = bodyOf('async function handleInboundChain(');

    expect(prelude).toContain('runSerializedInbound<InboundChainPayload>({');
    expect(prelude).toContain('handleInboundChain(payload, info');
    expect(prelude.indexOf("from('messages')\n    .insert(")).toBeLessThan(
      prelude.indexOf('runSerializedInbound')
    );
    for (const handler of [
      'processOwnerChatbotMessage(',
      'processBuyerQualificationMessage(',
      'handleUpdateSessionInput(',
      'dispatchInboundToFlows({',
      'runAutomationsForTrigger({',
    ]) {
      expect(chain).toContain(handler);
      expect(prelude).not.toContain(handler);
    }
  });

  it('[INB-016] reads the contact and conversation afresh after waiting, and rechecks the first inbound under the lease', () => {
    const chain = bodyOf('async function handleInboundChain(');
    expect(chain).toContain("reloadRow('contacts', accountId");
    expect(chain).toContain("reloadRow('conversations', accountId");
    expect(chain).toContain(
      'isEarliestCustomerMessage(conversation.id, message.id)'
    );
  });
});
