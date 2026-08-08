import { describe, expect, it } from "vitest";

import {
  GROUP_WEBHOOK_FIELDS,
  isGroupWebhookField,
  processGroupWebhook,
} from "./group-webhooks";

describe("isGroupWebhookField", () => {
  it("recognises every field a group subscription delivers", () => {
    for (const field of GROUP_WEBHOOK_FIELDS) {
      expect(isGroupWebhookField(field)).toBe(true);
    }
  });

  it("does not claim the ordinary messages field", () => {
    // `messages` carries group message *status* too, but it is handled
    // by the existing pipeline — claiming it here would double-process
    // every inbound message in the account.
    expect(isGroupWebhookField("messages")).toBe(false);
    expect(isGroupWebhookField("message_template_status_update")).toBe(false);
  });

  it("rejects an unknown field rather than guessing", () => {
    expect(isGroupWebhookField("group_something_new")).toBe(false);
  });
});

describe("processGroupWebhook", () => {
  // Meta retries a webhook that does not return 2xx, so an unexpected
  // payload has to be a no-op rather than a throw — otherwise one
  // malformed event is redelivered indefinitely.
  it("ignores an unknown field without touching the database", async () => {
    await expect(
      processGroupWebhook("acct", "not_a_group_field", { group_id: "g" }),
    ).resolves.toBeUndefined();
  });

  it("ignores a null or non-object value", async () => {
    await expect(
      processGroupWebhook("acct", "group_status_update", null),
    ).resolves.toBeUndefined();
    await expect(
      processGroupWebhook("acct", "group_status_update", "suspended"),
    ).resolves.toBeUndefined();
  });

  it("swallows a payload with no group id instead of throwing", async () => {
    // Reaches the handler, finds nothing to act on, returns. If this
    // threw, the Supabase client would be constructed and the test
    // would fail on credentials rather than on the guard.
    await expect(
      processGroupWebhook("acct", "group_settings_update", {}),
    ).resolves.toBeUndefined();
  });
});
