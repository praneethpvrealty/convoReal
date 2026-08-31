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
  varKey: string
): KnownBriefValue | null {
  if (!contact) return null;
  const prefs = prefsFromContact(contact);
  if (varKey === 'budget') {
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
    "I'll use this to find matches. If anything has changed, just type the update and I'll refresh it.",
  ].join('\n');
}

/** Marks the run as having already sent the note above. */
export const BRIEF_CONFIRMED_VAR = '__brief_confirmed';
