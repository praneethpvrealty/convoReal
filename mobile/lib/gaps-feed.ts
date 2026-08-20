/**
 * Conversation gaps — the pure half.
 *
 * Kept apart from `gaps.ts` because that file reaches `api.ts` and so
 * pulls in React Native, which has no runtime under the plain Node
 * test runner (root AGENTS.md §12). Everything here is orderings and
 * formatting, which is exactly what wants proving. Same split as
 * pulse.ts / pulse-feed.ts.
 *
 * No judgement about what a gap IS lives here — that is server-side in
 * src/lib/sweep/, so web and mobile cannot drift about it. The sorting
 * below is mirrored from the web screen deliberately.
 */

export type GapKind =
  | 'unanswered_question'
  | 'unkept_promise'
  | 'untracked_conversation'
  | 'bot_handoff'
  | 'unmatched_requirement';

export type GapSeverity = 'high' | 'medium' | 'low';

export interface ConversationGap {
  id: string;
  kind: GapKind;
  severity: GapSeverity;
  summary: string;
  evidence: string;
  suggested_action: string | null;
  occurred_at: string;
  occurrence_count: number;
  channel: 'client' | 'personal_whatsapp';
  contact_id: string | null;
  conversation_id: string | null;
  contacts: { id: string; name: string | null } | null;
}

export const GAP_LABEL: Record<GapKind, string> = {
  unanswered_question: 'Unanswered',
  unkept_promise: 'Promised',
  untracked_conversation: 'Nothing next',
  bot_handoff: 'Bot overridden',
  unmatched_requirement: 'Nothing sent',
};

export const GAP_ICON: Record<GapKind, string> = {
  unanswered_question: 'help-circle-outline',
  unkept_promise: 'send-outline',
  untracked_conversation: 'calendar-outline',
  bot_handoff: 'chatbubbles-outline',
  unmatched_requirement: 'sparkles-outline',
};

const SEVERITY_RANK: Record<GapSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Worst first; within a severity, the one outstanding longest.
 *  Mirrors the web ordering exactly. */
export function sortGaps(gaps: ConversationGap[]): ConversationGap[] {
  return [...gaps].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.occurrence_count - a.occurrence_count;
  });
}

export function countByKind(
  gaps: ConversationGap[]
): { kind: GapKind; count: number }[] {
  const counts = new Map<GapKind, number>();
  for (const gap of gaps) counts.set(gap.kind, (counts.get(gap.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

export function relativeDay(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const hours = Math.round((now - then) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
