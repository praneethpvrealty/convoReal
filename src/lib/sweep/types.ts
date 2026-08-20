// ============================================================
// The shapes the daily sweep reads and writes.
//
// One thread is one conversation with one person over the window,
// flattened out of whichever store it came from. The client inbox
// lives in `messages`; the account holder's own WhatsApp reaches us
// as `journey_events` with channel 'personal_whatsapp' and is
// outbound-only. Collapsing both into this shape here is what lets
// every module downstream — transcript, detectors, analysis — be one
// implementation instead of two.
// ============================================================

export type SweepChannel = 'client' | 'personal_whatsapp';

export type SweepSpeaker = 'customer' | 'agent' | 'bot';

export interface SweepMessage {
  /** Null for personal-WhatsApp lines: a journey event is not a
   *  `messages` row, and a gap must not carry a foreign key that
   *  points nowhere. */
  id: string | null;
  speaker: SweepSpeaker;
  text: string;
  /** 'text', 'image', 'document', … — a thread of nothing but images
   *  is a thread with no language in it, and the analyser skips it. */
  contentType: string;
  createdAt: string;
}

export interface SweepThread {
  accountId: string;
  channel: SweepChannel;
  contactId: string | null;
  contactName: string | null;
  conversationId: string | null;
  assignedAgentId: string | null;
  /** The listing the thread is about, when one is identifiable — the
   *  newest share or enquiry against this contact. Facts read out of
   *  the thread attach to it. */
  propertyId: string | null;
  messages: SweepMessage[];
}

/**
 * What the rest of the account says about this thread's follow-through.
 *
 * Kept separate from the thread itself, and resolved in one batched
 * query per account rather than per thread, because every field here
 * is a "did anything happen elsewhere?" question. A detector that had
 * to reach the database could not be tested without one.
 */
export interface ThreadContext {
  hasOpenDeal: boolean;
  hasFutureAppointment: boolean;
  hasOpenTodo: boolean;
  /** Sent after the window closed. An unanswered question that was
   *  answered at 7am is not a gap by the time anyone reads the
   *  digest. */
  repliedAfterWindow: boolean;
  /** The contact states a requirement and nothing has ever been
   *  shared against it. */
  hasStatedRequirement: boolean;
  hasSharedAnyProperty: boolean;
}

export type GapKind =
  | 'unanswered_question'
  | 'unkept_promise'
  /** Was `missing_next_step` + `no_deal`, which asked one question
   *  twice and produced two cards per contact. See detectors.ts. */
  | 'untracked_conversation'
  | 'bot_handoff'
  | 'unmatched_requirement';

export type GapSeverity = 'high' | 'medium' | 'low';

/** A gap as the detectors and the analyser produce it, before it is
 *  keyed and persisted. */
export interface DetectedGap {
  kind: GapKind;
  severity: GapSeverity;
  summary: string;
  evidence: string;
  suggestedAction: string | null;
  occurredAt: string;
  propertyId?: string | null;
}

export interface SweepFact {
  /** Whitelisted by src/lib/learning/fields.ts; anything else is
   *  dropped there rather than here. */
  field: string;
  value: unknown;
  entity: 'contact' | 'property';
  evidence: string;
}

export interface ThreadFindings {
  facts: SweepFact[];
  gaps: DetectedGap[];
}
