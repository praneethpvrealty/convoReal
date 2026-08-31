/**
 * What we already know about a lead, and how to say it back.
 *
 * A contact who has answered the budget question once — in this funnel,
 * on a call, through the preference flow — should not be asked it
 * again. Re-asking reads as nobody having kept a record, and the answer
 * we already hold is usually the better one.
 *
 * Pure: the engine does the contact lookup and passes the row in.
 */

import { formatBudgetINR } from '@/lib/outreach/playbooks';
import { prefsFromContact } from '@/lib/ai/buyer-qualification';
import type { BudgetContext } from '@/lib/bot/catalog-match';
import type { Contact } from '@/types';

/** A collect_input var_key this module can answer from the contact. */
export type KnownBriefKey = 'budget' | 'locality';

export interface KnownBriefValue {
  /** Stored into flow_runs.vars under the node's var_key. */
  value: string;
  /** Human label for the "here's what we have" note. */
  label: string;
}

export function knownBriefValue(
  contact: Contact | null | undefined,
  varKey: string,
  /**
   * Which budget the node is asking for. A stored ₹1–2 Cr purchase
   * budget is not a monthly rent budget, and both funnel branches ask
   * under the same `budget` var key — so a saved figure is reused only
   * when the contact has stated that same intent. Absent (which is
   * every flow authored before this field) means no reuse: one extra
   * question costs less than matching a renter against crores.
   */
  budgetContext?: BudgetContext | null
): KnownBriefValue | null {
  if (!contact) return null;
  const prefs = prefsFromContact(contact);
  if (varKey === 'budget') {
    if (!budgetContext) return null;
    const stated = (prefs.listing_types ?? []).map((t) =>
      String(t).toLowerCase()
    );
    if (!stated.includes(budgetContext)) return null;
    const text = formatBudgetINR(prefs.budget_min, prefs.budget_max);
    return text ? { value: text, label: `Budget: ${text}` } : null;
  }
  if (varKey === 'locality') {
    const areas = (prefs.areas ?? []).filter(Boolean).slice(0, 3);
    if (areas.length === 0) return null;
    return { value: areas.join(', '), label: `Area: ${areas.join(', ')}` };
  }
  return null;
}

/**
 * The one note that replaces the questions we skipped. Sent once per
 * run — the invitation to correct it covers every line at once.
 */
export function buildKnownBriefNote(labels: string[]): string {
  return [
    "📋 *Here's what I have on file for you:*",
    '',
    ...labels.map((l) => `• ${l}`),
    '',
    "I'll use this to find matches. If your budget has changed, type the new one and I'll update it right away — anything else, just tell me and it reaches your agent.",
  ].join('\n');
}

/** Marks the run as having already sent the note above. */
export const BRIEF_CONFIRMED_VAR = '__brief_confirmed';

/** Run var holding which budget the branch asked about, so a later
 *  correction reads a bare "3 Cr" the way the question would have. */
export const BUDGET_CONTEXT_VAR = '__budget_context';
