// ============================================================
// The 6am read-out.
//
// Delivered through createNotification with the 'daily_digest' event
// key, which means WhatsApp FREE TEXT and no template — the same
// choice, for the same reason, as agent-task-digest. §2.7 is blunt
// about it: four attempts at an agent-facing digest template all came
// back MARKETING, a category is permanent, and each attempt burns a
// name forever. The account holder is staff, not a lead, so there is
// nothing a template would buy here.
//
// Composition is a pure function so the wording can be tested without
// a database, a clock or a network — everything that decides WHAT is
// said is in `composeDigest`, and everything that decides whether it
// is sent at all is the ledger in run.ts.
// ============================================================

import { createNotification } from '@/lib/notifications/create';
import type { GapKind, GapSeverity } from './types';

/** Gaps named in the message body. Past this it stops being a digest
 *  and becomes a list nobody scrolls. */
const MAX_LISTED = 6;

export interface DigestGap {
  kind: GapKind;
  severity: GapSeverity;
  summary: string;
  occurrenceCount: number;
}

export interface DigestInput {
  gaps: DigestGap[];
  factsApplied: number;
  factsProposed: number;
  threadsAnalyzed: number;
}

const KIND_LABEL: Record<GapKind, string> = {
  unanswered_question: 'Unanswered',
  unkept_promise: 'Promised',
  missing_next_step: 'No next step',
  no_deal: 'Not on a pipeline',
  bot_handoff: 'Bot overridden',
  unmatched_requirement: 'Nothing sent',
};

const SEVERITY_RANK: Record<GapSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export interface ComposedDigest {
  title: string;
  body: string;
  /** False when there is genuinely nothing to say. A digest that
   *  arrives every morning to report nothing is how a digest gets
   *  muted, and a muted digest is worse than no digest — it is the
   *  one that will also be missed on the morning something is wrong. */
  worthSending: boolean;
}

export function composeDigest(input: DigestInput): ComposedDigest {
  const gaps = [...input.gaps].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    // Older first within a severity: a question unanswered for four
    // mornings outranks one from last night.
    return b.occurrenceCount - a.occurrenceCount;
  });

  const worthSending = gaps.length > 0 || input.factsProposed > 0;

  const highCount = gaps.filter((g) => g.severity === 'high').length;
  const title = gaps.length
    ? highCount
      ? `${gaps.length} gaps from yesterday — ${highCount} need you today`
      : `${gaps.length} gaps from yesterday`
    : 'Yesterday looks clean';

  const lines: string[] = [];
  for (const gap of gaps.slice(0, MAX_LISTED)) {
    const age =
      gap.occurrenceCount > 1 ? ` (${gap.occurrenceCount} days running)` : '';
    lines.push(`• ${KIND_LABEL[gap.kind]}: ${gap.summary}${age}`);
  }
  if (gaps.length > MAX_LISTED) {
    lines.push(`• …and ${gaps.length - MAX_LISTED} more`);
  }

  const learned: string[] = [];
  if (input.factsApplied) {
    learned.push(
      `${input.factsApplied} detail${input.factsApplied === 1 ? '' : 's'} filled in`
    );
  }
  if (input.factsProposed) {
    learned.push(`${input.factsProposed} waiting for your OK`);
  }
  if (learned.length) {
    if (lines.length) lines.push('');
    lines.push(`Learned from the conversations: ${learned.join(', ')}.`);
  }

  return { title, body: lines.join('\n').trim(), worthSending };
}

export interface SendDigestArgs {
  accountId: string;
  /** The account holder. One recipient by design — this is the
   *  brokerage's own read-back, not per-agent work like the task
   *  digest, and fanning it out would report an agent's own gaps to
   *  everyone. */
  userId: string;
  input: DigestInput;
}

/** Never throws: the digest is the last step of a run whose real work
 *  is already committed, and a WhatsApp failure must not mark the
 *  sweep failed. */
export async function sendSweepDigest(args: SendDigestArgs): Promise<boolean> {
  const composed = composeDigest(args.input);
  if (!composed.worthSending) return false;

  try {
    await createNotification({
      accountId: args.accountId,
      userId: args.userId,
      type: 'daily_digest',
      eventKey: 'daily_digest',
      title: composed.title,
      body: composed.body,
      link: '/gaps',
    });
    return true;
  } catch (err) {
    console.error('[sweep] digest send failed:', err);
    return false;
  }
}
