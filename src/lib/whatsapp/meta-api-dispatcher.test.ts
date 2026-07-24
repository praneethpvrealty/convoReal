import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encrypt } from "./encryption";

/**
 * Regression test for a real production incident: system-initiated
 * sends (no acting user — cron digests, bot replies) create a fresh
 * `conversations`/`contacts` row with `user_id: null`, but that column
 * is still NOT NULL (a legacy holdover from the pre-account tenancy
 * model — see migration 017_account_sharing.sql). Every send to a
 * contact without an existing conversation blew up with:
 *   "null value in column "user_id" of relation "conversations"
 *    violates not-null constraint"
 * Fixed by falling back to the account's owner_user_id instead of null.
 */

const ACCOUNT_ID = "acc-1";
const OWNER_USER_ID = "owner-1";
const CONTACT_ID = "contact-1";

type Row = Record<string, unknown>;

function makeDb(
  overrides: { existingConversation?: Row | null; duplicateMessage?: Row | null } = {},
) {
  const inserts: Record<string, Row[]> = { conversations: [], messages: [] };

  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      like: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      update: () => b,
      insert: (payload: Row) => {
        inserts[table] = inserts[table] || [];
        inserts[table].push(payload);
        return b;
      },
      maybeSingle: () => {
        if (table === "accounts") {
          return Promise.resolve({
            data: { owner_user_id: OWNER_USER_ID },
            error: null,
          });
        }
        if (table === "conversations") {
          return Promise.resolve({
            data: overrides.existingConversation ?? null,
            error: null,
          });
        }
        if (table === "contacts") {
          return Promise.resolve({
            data: { phone: "+919876543210" },
            error: null,
          });
        }
        if (table === "messages") {
          return Promise.resolve({ data: overrides.duplicateMessage ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        if (table === "whatsapp_config") {
          return Promise.resolve({
            data: {
              account_id: ACCOUNT_ID,
              integration_type: "official_api",
              phone_number_id: "phone-1",
              access_token: encrypt("test-access-token"),
            },
            error: null,
          });
        }
        if (table === "conversations") {
          const inserted = inserts.conversations.at(-1);
          return Promise.resolve({
            data: { id: "conv-new", ...inserted },
            error: null,
          });
        }
        if (table === "messages") {
          const inserted = inserts.messages.at(-1);
          return Promise.resolve({
            data: { id: "msg-new", ...inserted },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // conversations.update(...).eq(...) is awaited directly, no further chain.
      then: (resolve: (v: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return b;
  }

  return {
    from: (table: string) => builder(table),
    _inserts: inserts,
  };
}

describe("sendWhatsAppMessageAndPersist", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), {
          status: 200,
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the account owner's user_id when no userId is given (system-initiated send)", async () => {
    const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
    const db = makeDb();

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      kind: "text",
      senderType: "bot",
      text: "hello",
      customDbClient: db,
    });

    expect(result.success).toBe(true);
    expect(db._inserts.conversations).toHaveLength(1);
    expect(db._inserts.conversations[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      user_id: OWNER_USER_ID,
      contact_id: CONTACT_ID,
    });
  });

  it("uses the given userId directly and never looks up the account owner", async () => {
    const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
    const db = makeDb();
    const accountsSpy = vi.spyOn(db, "from");

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ACCOUNT_ID,
      userId: "agent-1",
      contactId: CONTACT_ID,
      kind: "text",
      senderType: "bot",
      text: "hello",
      customDbClient: db,
    });

    expect(result.success).toBe(true);
    expect(db._inserts.conversations[0]).toMatchObject({ user_id: "agent-1" });
    expect(accountsSpy.mock.calls.some(([table]) => table === "accounts")).toBe(
      false,
    );
  });

  it("reuses an existing conversation without creating a new one", async () => {
    const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
    const db = makeDb({ existingConversation: { id: "conv-existing" } });

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      kind: "text",
      senderType: "bot",
      text: "hello",
      customDbClient: db,
    });

    expect(result.success).toBe(true);
    expect(db._inserts.conversations).toHaveLength(0);
  });

  it("skips a duplicate substantial free-text send to the same conversation", async () => {
    const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
    const db = makeDb({
      existingConversation: { id: "conv-existing" },
      duplicateMessage: { id: "dup-1", message_id: "wamid.dup" },
    });
    const longText = "Here are the complete details for the property ".repeat(4);

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      kind: "text",
      senderType: "agent",
      text: longText,
      customDbClient: db,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("dup-1");
    expect(result.whatsappMessageId).toBe("wamid.dup");
    // No new message row and no Meta call — it was collapsed as a duplicate.
    expect(db._inserts.messages).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not dedupe short repeated messages (only substantial text)", async () => {
    const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
    const db = makeDb({
      existingConversation: { id: "conv-existing" },
      duplicateMessage: { id: "dup-1", message_id: "wamid.dup" },
    });

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      kind: "text",
      senderType: "agent",
      text: "ok",
      customDbClient: db,
    });

    expect(result.success).toBe(true);
    expect(db._inserts.messages).toHaveLength(1);
  });
});
