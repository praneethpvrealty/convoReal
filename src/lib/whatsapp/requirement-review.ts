// The requirement, played back — with one-tap corrections.
//
// "Nothing fits that yet" is a dead end when the lead cannot see what
// *that* is: the brief may be months old, and a wrong field silently
// filters every future alert. So the no-match ending shows the full
// saved requirement and hands each piece back as a tap — change type
// (type list), change budget (band list), change areas (typed), or
// the full form. "All correct" is itself an answer worth having: it
// converts a stale extraction into a confirmed brief.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sendPropertyTypePrompt } from '@/lib/whatsapp/property-type-prompt';
import { sendBudgetBandPrompt } from '@/lib/whatsapp/budget-band';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import type { Contact } from '@/types';

/** Every id this module owns starts with this. */
export const REQUIREMENT_TWEAK_ID_PREFIX = 'tw_';

function inr(n: number): string {
  return n >= 10_000_000
    ? `₹${(n / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`
    : n >= 100_000
      ? `₹${(n / 100_000).toFixed(2).replace(/\.?0+$/, '')} L`
      : `₹${n.toLocaleString('en-IN')}`;
}

function budgetLabel(contact: Contact): string | null {
  if (contact.no_budget) return 'no fixed budget';
  const min = contact.pref_budget_min ?? contact.min_budget ?? null;
  const max = contact.pref_budget_max ?? contact.max_budget ?? null;
  if (min != null && max != null) return `${inr(min)}–${inr(max)}`;
  if (max != null) return `up to ${inr(max)}`;
  if (min != null) return `above ${inr(min)}`;
  return null;
}

/**
 * One line the lead recognises as their own brief, or null when there
 * is nothing on file worth playing back.
 */
export function buildRequirementSummary(contact: Contact): string | null {
  const parts: string[] = [];

  const types = contact.pref_property_types?.length
    ? contact.pref_property_types
    : (contact.pref_property_categories ?? []);
  if (types.length) parts.push(types.slice(0, 2).join(' / '));

  if (contact.pref_bhk_min != null || contact.pref_bhk_max != null) {
    const lo = contact.pref_bhk_min ?? contact.pref_bhk_max;
    const hi = contact.pref_bhk_max ?? contact.pref_bhk_min;
    parts.push(lo === hi ? `${lo} BHK` : `${lo}–${hi} BHK`);
  }

  const seen = new Set<string>();
  const areas = [
    ...(contact.areas_of_interest ?? []),
    ...(contact.pref_areas ?? []),
  ].filter((a) => {
    const key = a.trim().toLowerCase();
    if (!key || key === 'bangalore' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (areas.length) parts.push(`near ${areas.slice(0, 3).join(', ')}`);

  const budget = budgetLabel(contact);
  if (budget) parts.push(budget);

  if (
    contact.pref_listing_types?.includes('Rent') &&
    !contact.pref_listing_types.includes('Sale')
  ) {
    parts.push('to rent');
  }

  return parts.length ? parts.join(' · ') : null;
}

function firstName(name: string | null | undefined): string {
  return isPlaceholderLeadName(name) ? 'there' : name!.trim().split(/\s+/)[0];
}

/**
 * The playback card: the saved brief in the body, each field a tap
 * away from correction. Returns false when there is nothing on file
 * to review — the caller falls back to its plain reply.
 */
export async function sendRequirementReview(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  contact: Contact;
}): Promise<boolean> {
  const summary = buildRequirementSummary(args.contact);
  if (!summary) return false;

  try {
    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'list',
      interactiveBody: [
        `Thanks ${firstName(args.contact.name)} — nothing live fits this yet, but our engine is watching. Here's what I'm matching against:`,
        '',
        `📌 ${summary}`,
        '',
        "You'll hear from us the moment a matching listing arrives. Spot something off? Tweak it below.",
      ].join('\n'),
      interactiveButtonLabel: 'Review / tweak',
      interactiveSections: [
        {
          rows: [
            { id: 'tw_ok', title: 'All correct 👍' },
            { id: 'tw_type', title: 'Change property type' },
            { id: 'tw_budget', title: 'Change budget' },
            { id: 'tw_area', title: 'Change areas' },
            {
              id: 'lfb_form',
              title: 'Update full form',
              description: 'Everything in one place',
            },
          ],
        },
      ],
      customDbClient: args.db,
    });
    return result.success;
  } catch (err) {
    console.error('[requirement-review] send failed:', err);
    return false;
  }
}

/**
 * Routes a tw_* tap. Type and budget re-open their tap lists (whose
 * own handlers re-run the ladder and land back on a fresh playback);
 * areas fall back to a typed answer the qualification ladder parses.
 */
export async function handleRequirementTweakReply(args: {
  db: SupabaseClient;
  accountId: string;
  configOwnerUserId: string;
  contactId: string;
  conversationId: string;
  replyId: string;
}): Promise<boolean> {
  const {
    db,
    accountId,
    configOwnerUserId,
    contactId,
    conversationId,
    replyId,
  } = args;

  const send = (text: string) =>
    sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId,
      conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
      customDbClient: db,
    });

  try {
    switch (replyId) {
      case 'tw_ok':
        await send(
          "Perfect — locked in 👍 Our engine is watching the market for you; the moment a matching listing arrives, you'll see it here first."
        );
        return true;
      case 'tw_type':
        await sendPropertyTypePrompt({
          db,
          accountId,
          userId: configOwnerUserId,
          contactId,
          conversationId,
          bodyText: 'What should I look for instead?',
        });
        return true;
      case 'tw_budget':
        await sendBudgetBandPrompt({
          db,
          accountId,
          userId: configOwnerUserId,
          contactId,
          conversationId,
        });
        return true;
      case 'tw_area':
        await send(
          "Which areas should I focus on? Name one or two localities and I'll re-run the search."
        );
        return true;
      default:
        return false;
    }
  } catch (err) {
    console.error('[requirement-review] tweak handling failed:', err);
    // The tap was ours; falling through would hand it to handlers
    // that cannot make sense of it.
    return true;
  }
}
