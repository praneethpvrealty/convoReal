import { describe, expect, it } from "vitest";

import {
  MAX_GROUP_PARTICIPANTS,
  botMayReply,
  canSendKindToGroup,
  groupIsSendable,
  hasRoomForParticipant,
  isGroupConversation,
  refuseGroupSend,
} from "./groups";

describe("isGroupConversation", () => {
  it("is true only when a group is attached", () => {
    expect(isGroupConversation({ group_id: "g1" })).toBe(true);
    expect(isGroupConversation({ group_id: null })).toBe(false);
    expect(isGroupConversation({})).toBe(false);
    expect(isGroupConversation(null)).toBe(false);
  });
});

describe("canSendKindToGroup", () => {
  it("allows the three kinds groups render", () => {
    expect(canSendKindToGroup("text")).toBe(true);
    expect(canSendKindToGroup("media")).toBe(true);
    expect(canSendKindToGroup("template")).toBe(true);
  });

  it("refuses interactive kinds, which groups reject with 130501", () => {
    expect(canSendKindToGroup("interactive")).toBe(false);
    expect(canSendKindToGroup("product")).toBe(false);
  });
});

describe("refuseGroupSend", () => {
  it("is silent for a kind that works", () => {
    expect(refuseGroupSend("text")).toBeNull();
  });

  it("explains the refusal in terms the agent can act on", () => {
    const reason = refuseGroupSend("interactive");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/text, media or an approved template/);
  });
});

describe("botMayReply", () => {
  // The bot answers with buttons and lists. In a group those are
  // refused, so an automated reply is either silence or plain-text spam
  // to eight people — it has to stay out entirely.
  it("keeps the bot out of group threads", () => {
    expect(botMayReply({ group_id: "g1" })).toBe(false);
  });

  it("leaves one-to-one threads alone", () => {
    expect(botMayReply({ group_id: null })).toBe(true);
    expect(botMayReply({})).toBe(true);
  });
});

describe("hasRoomForParticipant", () => {
  it("stops at Meta's cap", () => {
    expect(hasRoomForParticipant(MAX_GROUP_PARTICIPANTS - 1)).toBe(true);
    expect(hasRoomForParticipant(MAX_GROUP_PARTICIPANTS)).toBe(false);
  });

  it("uses eight, which is the documented ceiling", () => {
    expect(MAX_GROUP_PARTICIPANTS).toBe(8);
  });
});

describe("groupIsSendable", () => {
  it("is true only for an active group", () => {
    expect(groupIsSendable("active")).toBe(true);
  });

  it("is false for a group that is suspended, pending or gone", () => {
    for (const status of ["suspended", "pending", "deleted", "failed", null]) {
      expect(groupIsSendable(status)).toBe(false);
    }
  });
});
