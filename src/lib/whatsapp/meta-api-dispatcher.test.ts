import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encrypt } from "./encryption";
import { isReengagementError } from "./customer-window";

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
  overrides: {
    existingConversation?: Row | null;
    duplicateMessage?: Row | null;
    /** When the contact last messaged in. Defaults to "just now" so the
     *  24-hour window is open — the ordinary case for a bot reply. Pass
     *  null to model a contact who has never messaged. */
    lastInboundAt?: string | null;
    integrationType?: string;
  } = {},
) {
  const inserts: Record<string, Row[]> = { conversations: [], messages: [] };
  const lastInboundAt =
    overrides.lastInboundAt === undefined
      ? new Date().toISOString()
      : overrides.lastInboundAt;

  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return b;
      },
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
          // The window lookup is the only messages query filtered on an
          // inbound sender; everything else is the duplicate guard.
          if (filters.sender_type === "customer") {
            return Promise.resolve({
              data: lastInboundAt ? { created_at: lastInboundAt } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: overrides.duplicateMessage ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        if (table === "whatsapp_config") {
          return Promise.resolve({
            data: {
              account_id: ACCOUNT_ID,
              integration_type: overrides.integrationType ?? "official_api",
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

  /**
   * Meta's 24-hour customer service window, enforced at the one point
   * every sender funnels through. Meta accepts a re-engagement send and
   * fails it asynchronously with 131047, so an unguarded free-form
   * message becomes a delivery-failure bubble in the thread minutes
   * later — automations, flows, reminders and notifications all reach
   * Meta through this function, and none of them checked.
   */
  describe("24-hour customer window", () => {
    const HOURS = 60 * 60 * 1000;

    it("refuses free-form text when the contact last messaged over 24 hours ago", async () => {
      const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
      const db = makeDb({
        existingConversation: { id: "conv-existing" },
        lastInboundAt: new Date(Date.now() - 30 * HOURS).toISOString(),
      });

      const result = await sendWhatsAppMessageAndPersist({
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        kind: "text",
        senderType: "agent",
        text: "here are the property details",
        customDbClient: db,
      });

      expect(result.success).toBe(false);
      expect(isReengagementError(result.error)).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(db._inserts.messages).toHaveLength(0);
    });

    it("refuses free-form text when the contact has never messaged in", async () => {
      const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
      const db = makeDb({
        existingConversation: { id: "conv-existing" },
        lastInboundAt: null,
      });

      const result = await sendWhatsAppMessageAndPersist({
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        kind: "text",
        senderType: "bot",
        text: "hello",
        customDbClient: db,
      });

      expect(result.success).toBe(false);
      expect(isReengagementError(result.error)).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("sends free-form text while the window is open", async () => {
      const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
      const db = makeDb({
        existingConversation: { id: "conv-existing" },
        lastInboundAt: new Date(Date.now() - 2 * HOURS).toISOString(),
      });

      const result = await sendWhatsAppMessageAndPersist({
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        kind: "text",
        senderType: "agent",
        text: "still chatting",
        customDbClient: db,
      });

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });

    it("lets a template through a closed window — that is what reopens it", async () => {
      const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
      const db = makeDb({
        existingConversation: { id: "conv-existing" },
        lastInboundAt: null,
      });

      const result = await sendWhatsAppMessageAndPersist({
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        kind: "template",
        senderType: "agent",
        templateName: "new_property_alert",
        text: "rendered body",
        customDbClient: db,
      });

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });

    it("leaves sandbox alone — /api/whatsapp/send swaps in its system template upstream", async () => {
      const { sendWhatsAppMessageAndPersist } = await import("./meta-api-dispatcher");
      const db = makeDb({
        existingConversation: { id: "conv-existing" },
        lastInboundAt: null,
        integrationType: "sandbox",
      });

      const result = await sendWhatsAppMessageAndPersist({
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        kind: "text",
        senderType: "agent",
        text: "sandbox reply",
        customDbClient: db,
      });

      // Sandbox credentials aren't configured in this harness, so the
      // send fails — but on the sandbox config, not the window.
      expect(isReengagementError(result.error)).toBe(false);
    });
  });
});
