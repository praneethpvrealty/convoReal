// Budget as one tap instead of one typed guess.
//
// Budget is the emptiest field in the funnel — every re-engaged lead
// so far has areas and a type on file, and not one has a budget. The
// free-text question makes stating it work: pick a number, guess the
// format, type it. A band is a tap, and a band is all matching needs —
// getMatchingContacts compares against a min/max range, never a point.
//
// The tap writes pref_budget_min/max directly. This is the lead's own
// stated range arriving over a deterministic channel, not a model
// guess, so it does not pass through the learning gate.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';

/** Every id this module owns starts with this. */
export const BUDGET_BAND_ID_PREFIX = 'bb_';

interface BudgetBand {
  id: string;
  title: string;
  min: number | null;
  max: number | null;
}

const SALE_BANDS: BudgetBand[] = [
  { id: 'bb_s0', title: 'Under ₹50 Lakh', min: null, max: 5_000_000 },
  { id: 'bb_s1', title: '₹50 Lakh – 1 Cr', min: 5_000_000, max: 10_000_000 },
  { id: 'bb_s2', title: '₹1 – 2 Cr', min: 10_000_000, max: 20_000_000 },
  { id: 'bb_s3', title: '₹2 – 5 Cr', min: 20_000_000, max: 50_000_000 },
  { id: 'bb_s4', title: 'Above ₹5 Cr', min: 50_000_000, max: null },
];

/** Monthly rent bands, used when the lead's stated intent is Rent
 *  only — matching compares rent listings on rent_per_month. */
const RENT_BANDS: BudgetBand[] = [
  { id: 'bb_r0', title: 'Under ₹25K / month', min: null, max: 25_000 },
  { id: 'bb_r1', title: '₹25K – 50K / month', min: 25_000, max: 50_000 },
  { id: 'bb_r2', title: '₹50K – 1L / month', min: 50_000, max: 100_000 },
  { id: 'bb_r3', title: 'Above ₹1L / month', min: 100_000, max: null },
];

const BAND_BY_ID = new Map(
  [...SALE_BANDS, ...RENT_BANDS].map((b) => [b.id, b])
);

const NO_BUDGET_ID = 'bb_none';

export function budgetBandAcknowledgement(replyId: string): string | null {
  if (replyId === NO_BUDGET_ID) {
    return "Got it — I've noted that you don't have a fixed budget and kept the rest of your search unchanged.";
  }
  const band = BAND_BY_ID.get(replyId);
  if (!band) return null;
  const label = band.title.charAt(0).toLowerCase() + band.title.slice(1);
  return `Got it — I've changed your budget to ${label} and kept the rest of your search unchanged.`;
}

export function isRentOnlyIntent(
  listingTypes: string[] | null | undefined
): boolean {
  const types = listingTypes ?? [];
  return types.includes('Rent') && !types.includes('Sale');
}

/**
 * The band list. `includeFormRow` appends the same full-form row the
 * listing-feedback list uses — the id is deliberately lfb_form so the
 * existing webhook route to the preference form serves both lists.
 */
export function buildBudgetBandSections(opts: {
  rentOnly?: boolean;
  includeFormRow?: boolean;
}): InteractiveListSection[] {
  const rows = (opts.rentOnly ? RENT_BANDS : SALE_BANDS).map((b) => ({
    id: b.id,
    title: b.title,
  }));
  rows.push({ id: NO_BUDGET_ID, title: 'No fixed budget' });
  if (opts.includeFormRow) {
    rows.push({ id: 'lfb_form', title: 'Update preferences' });
  }
  return [{ rows }];
}

/**
 * Sends the band list. Reads the contact's stated intent to pick sale
 * or rent bands. Never throws.
 */
export async function sendBudgetBandPrompt(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  bodyText?: string;
  includeFormRow?: boolean;
}): Promise<boolean> {
  try {
    const { data: contact } = await args.db
      .from('contacts')
      .select('pref_listing_types')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle();

    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      kind: 'interactive',
      senderType: 'bot',
      interactiveType: 'list',
      interactiveBody:
        args.bodyText ??
        "What budget should I work with? Pick a range and I'll only send listings inside it.",
      interactiveButtonLabel: 'Pick a range',
      interactiveSections: buildBudgetBandSections({
        rentOnly: isRentOnlyIntent(
          contact?.pref_listing_types as string[] | null
        ),
        includeFormRow: args.includeFormRow,
      }),
      customDbClient: args.db,
    });
    return result.success;
  } catch (err) {
    console.error('[budget-band] prompt send failed:', err);
    return false;
  }
}

/**
 * Applies a tapped band to the contact. Returns true when the tap was
 * consumed — the caller owes the lead the re-ranked shortlist that
 * makes answering feel worth it (sendPreferenceMatchFollowUp).
 */
export async function handleBudgetBandReply(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  replyId: string;
}): Promise<boolean> {
  const { db, accountId, contactId, replyId } = args;

  const patch =
    replyId === NO_BUDGET_ID
      ? { no_budget: true, pref_budget_min: null, pref_budget_max: null }
      : (() => {
          const band = BAND_BY_ID.get(replyId);
          if (!band) return null;
          return {
            no_budget: false,
            pref_budget_min: band.min,
            pref_budget_max: band.max,
          };
        })();
  if (!patch) return false;

  try {
    await db
      .from('contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('account_id', accountId);
    return true;
  } catch (err) {
    console.error('[budget-band] contact update failed:', err);
    // The tap was ours; falling through would hand a band id to
    // handlers that cannot make sense of it.
    return true;
  }
}
