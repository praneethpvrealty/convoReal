import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encrypt } from "./encryption";
import { validatePreferenceFlowJson } from "./meta-flow-service";
import { PREFERENCE_FLOW_KEY } from "./preference-flow";

/**
 * Exercises validatePreferenceFlowJson against a stubbed Graph API so
 * we can assert it surfaces Meta's real validation_errors verbatim
 * (rather than any hand-coded assumption about Meta's rules) and never
 * calls /publish.
 */

const CONFIG_ROW = {
  account_id: "acc-1",
  user_id: "user-1",
  phone_number_id: "phone-1",
  waba_id: "waba-1",
  access_token: encrypt("test-access-token"),
  integration_type: "official_api",
  flows_private_key: null,
  flows_public_key: null,
  flows_key_registered_at: null,
};

function makeDb(metaFlowRow: { meta_flow_id: string | null } | null) {
  const upsertCalls: unknown[] = [];
  const db = {
    from(table: string) {
      if (table === "whatsapp_config") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: CONFIG_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === "whatsapp_meta_flows") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: metaFlowRow, error: null }),
              }),
            }),
          }),
          upsert: (payload: unknown) => {
            upsertCalls.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
    _upsertCalls: upsertCalls,
  };
  return db as unknown as NonNullable<
    Parameters<typeof validatePreferenceFlowJson>[0]["db"]
  > & { _upsertCalls: unknown[] };
}

describe("validatePreferenceFlowJson", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses an existing meta_flow_id and never calls /publish", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      expect(url).not.toMatch(/\/publish$/);
      if (url.endsWith("/flow-existing/assets")) {
        return new Response(JSON.stringify({ validation_errors: [] }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const db = makeDb({ meta_flow_id: "flow-existing" });
    const result = await validatePreferenceFlowJson({ accountId: "acc-1", db });

    expect(result).toEqual({ valid: true, errors: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces Meta's validation_errors verbatim when the flow JSON is rejected", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/flow-existing/assets")) {
        return new Response(
          JSON.stringify({
            validation_errors: [
              {
                message:
                  "Property 'init-value' is not allowed in 'TextInput' component.",
                line_start: 42,
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const db = makeDb({ meta_flow_id: "flow-existing" });
    const result = await validatePreferenceFlowJson({ accountId: "acc-1", db });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        message:
          "Property 'init-value' is not allowed in 'TextInput' component.",
        line_start: 42,
      },
    ]);
  });

  it("creates a draft flow container first when none exists yet, then uploads for validation", async () => {
    const calls: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/waba-1/flows")) {
        return new Response(JSON.stringify({ id: "flow-new" }), { status: 200 });
      }
      if (url.endsWith("/flow-new/assets")) {
        return new Response(JSON.stringify({ validation_errors: [] }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const db = makeDb(null);
    const result = await validatePreferenceFlowJson({ accountId: "acc-1", db });

    expect(result).toEqual({ valid: true, errors: [] });
    expect(calls).toEqual([
      expect.stringContaining("/waba-1/flows"),
      expect.stringContaining("/flow-new/assets"),
    ]);
    expect(db._upsertCalls[0]).toMatchObject({
      flow_key: PREFERENCE_FLOW_KEY,
      meta_flow_id: "flow-new",
    });
  });
});
