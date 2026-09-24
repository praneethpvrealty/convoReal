import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    parkedWaits: [] as { id: string; log_id: string | null }[],
    inserts: [] as { table: string; payload: unknown }[],
    logUpdates: [] as { filters: [string, string, unknown][]; payload: unknown }[],
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (type === "insert") state.inserts.push({ table, payload: ops.payload });
    if (table === "automation_pending_executions" && type === "select") {
      return { data: state.parkedWaits, error: null };
    }
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "automations") return { data: state.automations, error: null };
    if (table === "automation_logs") {
      if (type === "insert") return { data: { id: "log1" }, error: null };
      if (type === "update") {
        state.logUpdates.push({ filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    if (table === "automation_steps") return { data: state.steps, error: null };
    if (table === "automation_pending_executions" && type === "update") {
      state.updateCalls.push({ table, filters: ops.filters });
      const id = ops.filters.find(([, k]) => k === "id")?.[2];
      return { data: id ? { id } : null, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      gte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

import { resumePendingExecution, runAutomationsForTrigger } from "./engine";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.parkedWaits = [];
  h.state.inserts = [];
  h.state.logUpdates = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("resumePendingExecution — claim ownership", () => {
  it("[INB-017] settles the pending row only under the claim token it was resumed with", async () => {
    h.state.automations = null as unknown as Record<string, unknown>[];

    await resumePendingExecution({
      id: "p1",
      automation_id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      contact_id: "c1",
      log_id: null,
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
      claim_token: "token-1",
    });

    const pending = h.state.updateCalls.filter(
      (c) => c.table === "automation_pending_executions",
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].filters).toContainEqual(["eq", "id", "p1"]);
    expect(pending[0].filters).toContainEqual(["eq", "claim_token", "token-1"]);
  });
});

describe("wait steps — one parked run per contact", () => {
  it("[INB-020] a contact reaching a wait again supersedes the run already parked there", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [waitStep()];
    h.state.parkedWaits = [{ id: "old-wait", log_id: "old-log" }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    const superseded = h.state.updateCalls.filter(
      (c) => c.table === "automation_pending_executions",
    );
    expect(superseded).toHaveLength(1);
    expect(superseded[0].filters).toContainEqual(["eq", "id", "old-wait"]);
    expect(superseded[0].filters).toContainEqual(["eq", "status", "pending"]);
    expect(
      h.state.logUpdates.some(
        (u) =>
          u.filters.some(([, k, v]) => k === "id" && v === "old-log") &&
          (u.payload as { status?: string }).status === "failed",
      ),
    ).toBe(true);
    const parked = h.state.inserts.filter(
      (i) => i.table === "automation_pending_executions",
    );
    expect(parked).toHaveLength(1);
    expect(parked[0].payload).toMatchObject({
      contact_id: "c1",
      next_step_position: 1,
      status: "pending",
    });
  });

  it("parks the first run for a contact without superseding anything", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [waitStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(
      h.state.updateCalls.filter((c) => c.table === "automation_pending_executions"),
    ).toHaveLength(0);
    expect(
      h.state.inserts.filter((i) => i.table === "automation_pending_executions"),
    ).toHaveLength(1);
  });
});

function waitStep() {
  return {
    id: "w1",
    automation_id: "a1",
    step_type: "wait",
    position: 0,
    parent_step_id: null,
    step_config: { amount: 1, unit: "days" },
  };
}

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}
