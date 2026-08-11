// ============================================================
// Engine control payloads — the interactive-button reply ids we mint
// ourselves, as opposed to anything a human typed.
//
// These need naming in one place because the webhook has two consumers
// that both look at an inbound reply and both want to claim it:
// handleBridgedAgentReply, which treats a staff quote-reply as an
// answer to the lead a ping was about, and the control dispatch further
// down, which runs the action the button stands for.
//
// A button tap carries the originating ping's context.id, so the bridge
// matches it first and — before this predicate existed — relayed
// "✅ Approve" into a lead thread while the approval it was meant to
// perform never ran.
// ============================================================

import {
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  OWNER_APPROVE_PREFIX,
  OWNER_REJECT_PREFIX,
} from '@/lib/inventory/location-requests';

/** Prefixes whose replies are instructions to the Engine. Bare ids
 *  (no trailing payload) belong in EXACT_CONTROL_REPLY_IDS instead. */
export const CONTROL_REPLY_PREFIXES = [
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  OWNER_APPROVE_PREFIX,
  OWNER_REJECT_PREFIX,
] as const;

/** True when this reply id is a button the Engine minted, and so must
 *  never be mistaken for a staff member answering a lead. */
export function isEngineControlReplyId(replyId: string): boolean {
  return CONTROL_REPLY_PREFIXES.some((prefix) => replyId.startsWith(prefix));
}
