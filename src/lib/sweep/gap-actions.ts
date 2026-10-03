import type { GapKind } from './types';

export interface GapActionInput {
  kind: GapKind;
  suggested_action: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  contacts: { id: string } | null;
}

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

export function gapPrimaryAction(gap: GapActionInput): GapPrimaryAction | null {
  const label = gap.suggested_action?.trim();
  if (!label || !ACTIONABLE_KINDS.has(gap.kind)) return null;
  if (gap.conversation_id) {
    return { href: gapConversationHref(gap.conversation_id), label };
  }
  const contactId = gap.contact_id ?? gap.contacts?.id ?? null;
  if (contactId) {
    return {
      href: `/contacts?contactId=${encodeURIComponent(contactId)}`,
      label,
    };
  }
  return null;
}
