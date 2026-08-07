// ============================================================
// Requirement responses — the server half of interactive co-broker
// sharing (migration 210).
//
// Two response paths converge here:
//   web      — the /req page's inline listing form stashes a
//              public_listing_submissions row carrying the link id;
//              listing-verification.ts calls recordRequirementResponse
//              once the LIST- code verifies.
//   whatsapp — a co-broker texts the REQ-XXXX reference to the engine
//              number; processRequirementReply reveals the brief and
//              opens an external listing intake session carrying the
//              link id; chatbot-engine calls recordRequirementResponse
//              at Confirm.
//
// A live share link is what authorises the reveal: the reference alone
// (quoted from an old copy-paste digest) resolves to nothing once the
// link expires or is revoked, and the webhook falls through untouched.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkAccountPropertyLimit } from '@/lib/billing/gates';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  formatRequirement,
  requirementReference,
  type ShareableRequirement,
} from './share';
import {
  extractRequirementReference,
  type RequirementShareLink,
} from './share-links';

export interface RequirementLinkWithContact {
  link: RequirementShareLink;
  requirement: ShareableRequirement;
}

interface LinkRow extends RequirementShareLink {
  contacts: {
    id: string;
    name: string | null;
    classification: string | null;
    no_budget: boolean | null;
    min_budget: number | null;
    max_budget: number | null;
    requirements: string | null;
    areas_of_interest: string[] | null;
    projects_of_interest: string[] | null;
    requirement_active: boolean | null;
  } | null;
}

/**
 * Resolves a REQ-XXXX reference against an account's live links. The
 * reference is derived from the contact UUID, so candidates are the
 * account's live links compared by computed reference — newest first,
 * which also settles the rare in-account prefix collision in favour of
 * the link most recently shared.
 */
export async function findLiveRequirementLink(
  db: SupabaseClient,
  accountId: string,
  reference: string
): Promise<RequirementLinkWithContact | null> {
  const { data, error } = await db
    .from('requirement_share_links')
    .select(
      '*, contacts:contact_id (id, name, classification, no_budget, min_budget, max_budget, requirements, areas_of_interest, projects_of_interest, requirement_active)'
    )
    .eq('account_id', accountId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) return null;

  for (const row of data as LinkRow[]) {
    const { contacts, ...link } = row;
    if (!contacts) continue;
    if (requirementReference(contacts.id) !== reference) continue;
    return { link, requirement: { ...contacts } };
  }
  return null;
}

/** Resolves a public /req token to a live link, or null. */
export async function resolveRequirementLinkByToken(
  db: SupabaseClient,
  token: string
): Promise<RequirementLinkWithContact | null> {
  if (!token || token.length < 20) return null;

  const { data, error } = await db
    .from('requirement_share_links')
    .select(
      '*, contacts:contact_id (id, name, classification, no_budget, min_budget, max_budget, requirements, areas_of_interest, projects_of_interest, requirement_active)'
    )
    .eq('token', token)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  const row = data as LinkRow;
  if (!row.contacts) return null;
  const { contacts, ...link } = row;
  return { link, requirement: { ...contacts } };
}

/** Fire-and-forget open counter. Never blocks the render. */
export async function trackRequirementLinkView(
  db: SupabaseClient,
  link: Pick<RequirementShareLink, 'id' | 'view_count'>
): Promise<void> {
  const { error } = await db
    .from('requirement_share_links')
    .update({
      view_count: (link.view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('id', link.id);
  if (error) {
    console.error('[requirement-links] View tracking failed:', error);
  }
}

interface ReplyArgs {
  accountId: string;
  contentText: string | null;
  senderPhone: string;
  contactRecord: { id: string; classification?: string | null };
  conversationId: string;
}

/**
 * Called by the webhook for inbound texts from non-owners. Returns
 * true when the message quoted a REQ-XXXX reference backed by a live
 * share link and we opened (or refreshed) a listing intake session for
 * it; false for everything else so the caller falls through untouched.
 */
export async function processRequirementReply(
  args: ReplyArgs
): Promise<boolean> {
  const { accountId, contentText, senderPhone, contactRecord, conversationId } =
    args;

  const reference = extractRequirementReference(contentText);
  if (!reference) return false;

  const db = supabaseAdmin();
  const resolved = await findLiveRequirementLink(db, accountId, reference);
  if (!resolved) return false;

  const reply = (text: string) =>
    sendWhatsAppMessageAndPersist({
      accountId,
      contactId: contactRecord.id,
      conversationId,
      toPhone: senderPhone,
      kind: 'text',
      senderType: 'bot',
      text,
    });

  if (resolved.requirement.requirement_active === false) {
    await reply(
      `This requirement (${reference}) is no longer active — thanks for reaching out! We'll share fresh ones as they come in.`
    );
    return true;
  }

  const { limitReached } = await checkAccountPropertyLimit(db, accountId);
  if (limitReached) {
    await reply(
      `Thanks for responding to ${reference}! We can't take new listings over WhatsApp right now — please message the team directly with your property details.`
    );
    return true;
  }

  const { error: insertErr } = await db.from('property_draft_sessions').insert({
    account_id: accountId,
    contact_id: contactRecord.id,
    draft_data: { images: [] },
    status: 'collecting',
    session_mode: 'external',
    requirement_link_id: resolved.link.id,
  });
  if (insertErr) {
    if (
      insertErr.code === '23505' ||
      insertErr.message?.includes('duplicate key')
    ) {
      await db
        .from('property_draft_sessions')
        .update({
          requirement_link_id: resolved.link.id,
          updated_at: new Date().toISOString(),
        })
        .eq('contact_id', contactRecord.id)
        .eq('session_mode', 'external');
    } else {
      console.error(
        '[requirement-links] intake session insert failed:',
        insertErr
      );
    }
  }

  // A responder is a co-broker by definition — surface them in the
  // agent network (only upgrade generic contacts).
  if (
    !contactRecord.classification ||
    contactRecord.classification === 'Others'
  ) {
    await db
      .from('contacts')
      .update({ classification: 'Agent' })
      .eq('id', contactRecord.id);
  }

  await reply(
    `🤝 *You're responding to this requirement:*\n\n` +
      `• ${formatRequirement(resolved.requirement, resolved.link.mode)}\n\n` +
      `*Got a matching listing?* Send the details and photos right here — ` +
      `we'll piece it together and show you a preview before it's submitted.\n\n` +
      `_Type *cancel* anytime to stop._`
  );
  return true;
}

/**
 * Ties a submitted listing back to the requirement it answered: files
 * a note on the requirement contact (authored by whoever minted the
 * link) so the response surfaces on the requirements card, and returns
 * the REQ-XXXX reference for the submitter's confirmation message.
 * Best-effort — a missing or dead link never fails the submission.
 */
export async function recordRequirementResponse(
  db: SupabaseClient,
  requirementLinkId: string,
  info: { propertyCode: string | null; title: string }
): Promise<string | null> {
  const { data: link } = await db
    .from('requirement_share_links')
    .select('id, account_id, contact_id, created_by')
    .eq('id', requirementLinkId)
    .maybeSingle();
  if (!link) return null;

  const reference = requirementReference(link.contact_id as string);

  if (link.created_by) {
    const codePart = info.propertyCode ? ` (${info.propertyCode})` : '';
    const { error } = await db.from('contact_notes').insert({
      account_id: link.account_id,
      contact_id: link.contact_id,
      user_id: link.created_by,
      note_text: `Co-broker responded to shared requirement ${reference}: "${info.title}"${codePart} submitted for review.`,
    });
    if (error) {
      console.error('[requirement-links] response note insert failed:', error);
    }
  }

  return reference;
}
