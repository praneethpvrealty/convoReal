// ============================================================
// One name, one category — Meta's rule for template languages.
//
// A template's language variants share a name, and Meta fixes that
// name's category the first time any variant reaches it. Submitting a
// second language under a different category is refused outright:
//
//   [Error 100] Invalid parameter: The category UTILITY doesn't match
//   the one that's already associated with this template, MARKETING.
//
// The Engine builders ask for UTILITY, and Meta has approved several
// of those English submissions as MARKETING (AGENTS.md §2.7 — a
// Utility submission that fails Meta's utility test is approved as
// MARKETING, not rejected). Every later translation of that name must
// therefore go out under MARKETING, whatever the builder says, or the
// reviewer's sign-off ends in a Meta error they cannot fix.
// ============================================================

import type { MessageTemplate } from '@/types';
import { normalizeCategory } from '@/lib/whatsapp/template-status-normalize';

export type TemplateCategory = MessageTemplate['category'];

export interface CategoryLockRow {
  category: string | null;
  meta_template_id: string | null;
  status?: string | null;
}

/**
 * The category Meta already associates with this template name, or
 * null when no variant has reached Meta yet. Rows that never left the
 * account (no meta_template_id) carry the builder's request, not
 * Meta's decision, and are ignored. An approved variant is the
 * surest record, so it wins over a pending or rejected one.
 */
export function metaHeldCategory(
  rows: ReadonlyArray<CategoryLockRow>
): TemplateCategory | null {
  const held = rows.filter((r) => r.meta_template_id && r.category);
  if (held.length === 0) return null;
  const approved = held.find(
    (r) => (r.status ?? '').toUpperCase() === 'APPROVED'
  );
  return normalizeCategory((approved ?? held[0]).category as string);
}

/**
 * The payload as Meta will accept it: the requested category when the
 * name is new to Meta, otherwise the category Meta already holds.
 */
export function withMetaHeldCategory<T extends { category: TemplateCategory }>(
  payload: T,
  rows: ReadonlyArray<CategoryLockRow>
): { payload: T; heldCategory: TemplateCategory | null } {
  const heldCategory = metaHeldCategory(rows);
  if (!heldCategory || heldCategory === payload.category) {
    return { payload, heldCategory };
  }
  return { payload: { ...payload, category: heldCategory }, heldCategory };
}
