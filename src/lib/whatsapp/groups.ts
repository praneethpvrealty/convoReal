/**
 * What a WhatsApp group can carry, and what has to be kept out of one.
 *
 * The Groups API is narrower than a 1:1 thread in ways that break
 * assumptions the rest of the Engine makes. These predicates are the
 * single place those limits live, so a caller never re-derives them:
 *
 *   - Interactive messages (buttons, lists, flows) are NOT supported.
 *     The bot, the funnels and the flow engine all answer with them, so
 *     they must not run on a group conversation — Meta answers 130501
 *     and the participant sees nothing.
 *   - Auth and commerce templates are out too, as are disappearing and
 *     view-once messages.
 *   - 8 participants, and people join by invite link only. There is no
 *     "add participant" call.
 */

/** Meta's ceiling on group size, including the business itself. */
export const MAX_GROUP_PARTICIPANTS = 8;

/** Groups per business phone number. */
export const MAX_GROUPS_PER_NUMBER = 10_000;

/** Meta's error when a group is sent something it cannot render. */
export const UNSUPPORTED_IN_GROUP_CODE = 130501;

/** Message kinds the dispatcher may send to a group. */
const GROUP_SENDABLE_KINDS = ['text', 'media', 'template'] as const;

export type GroupSendableKind = (typeof GROUP_SENDABLE_KINDS)[number];

export interface GroupConversationRef {
  /** Set when the conversation is a group thread. */
  group_id?: string | null;
}

/** Whether this conversation is a group rather than one contact. */
export function isGroupConversation(
  conversation: GroupConversationRef | null | undefined,
): boolean {
  return Boolean(conversation?.group_id);
}

/**
 * Whether a dispatcher `kind` can go to a group at all.
 *
 * 'interactive' and 'product' are the two that cannot: both render as
 * interactive messages, which groups reject outright.
 */
export function canSendKindToGroup(kind: string): kind is GroupSendableKind {
  return (GROUP_SENDABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * The reason a group send should be refused before it reaches Meta, or
 * null when it is fine. Refusing here means the agent sees why; letting
 * it through means Meta accepts the call and the group shows nothing.
 */
export function refuseGroupSend(kind: string): string | null {
  if (canSendKindToGroup(kind)) return null;
  return 'WhatsApp groups do not accept interactive messages — send text, media or an approved template instead.';
}

/**
 * Whether the bot may answer into this conversation.
 *
 * Every automated reply path the Engine has (funnels, flows, the
 * chatbot engine) leans on buttons and lists. In a group those are
 * refused, so the bot would either fall silent or spam plain-text
 * fallbacks at up to eight people at once. It stays out.
 */
export function botMayReply(
  conversation: GroupConversationRef | null | undefined,
): boolean {
  return !isGroupConversation(conversation);
}

/** Whether another participant would exceed Meta's cap. */
export function hasRoomForParticipant(activeCount: number): boolean {
  return activeCount < MAX_GROUP_PARTICIPANTS;
}

/**
 * Group status as the inbox should read it. A suspended group still
 * exists and still lists its participants, but nothing sends — so it
 * must not look active.
 */
export function groupIsSendable(status: string | null | undefined): boolean {
  return status === 'active';
}
