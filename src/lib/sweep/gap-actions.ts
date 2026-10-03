import type { GapKind } from './types';

export interface GapActionInput {
  kind: GapKind;
  suggested_action: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  contacts: { id: string } | null;
}

export type GapPrimaryTarget =
  | { type: 'conversation'; id: string; label: string }
  | { type: 'contact'; id: string; label: string };

export interface GapPrimaryAction {
  href: string;
  label: string;
}

const ACTIONABLE_KINDS: ReadonlySet<GapKind> = new Set([
  'unanswered_question',
  'unkept_promise',
  'untracked_conversation',
  'unmatched_requirement',
]);

export function gapConversationHref(conversationId: string): string {
  return `/inbox?c=${encodeURIComponent(conversationId)}`;
}

export function gapPrimaryTarget(gap: GapActionInput): GapPrimaryTarget | null {
  const label = gap.suggested_action?.trim();
  if (!label || !ACTIONABLE_KINDS.has(gap.kind)) return null;
  if (gap.conversation_id) {
    return { type: 'conversation', id: gap.conversation_id, label };
  }
  const contactId = gap.contact_id ?? gap.contacts?.id ?? null;
  if (contactId) return { type: 'contact', id: contactId, label };
  return null;
}

export function gapPrimaryAction(gap: GapActionInput): GapPrimaryAction | null {
  const target = gapPrimaryTarget(gap);
  if (!target) return null;
  return {
    href:
      target.type === 'conversation'
        ? gapConversationHref(target.id)
        : `/contacts?contactId=${encodeURIComponent(target.id)}`,
    label: target.label,
  };
}
