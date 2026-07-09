// ============================================================
// Document share view tracking.
//
// property_document_requests recorded that a share was SENT
// (share_sent_at) but never whether the recipient actually opened it
// — the exact "did they engage" gap the buyer showcase funnel already
// closes for property listings via Showcase Pulse. This closes it for
// shared documents.
//
// Every open is tracked, not just the first: the share link has no
// per-recipient identity (the gate is a shared password, not a login),
// so we can't tell whether a later open is the original requester
// re-reading it or someone they forwarded the link to (a spouse,
// lawyer, business partner — normal for property documents). Rather
// than guess, every open past the first bumps view_count and is
// surfaced as its own event, worded to flag that ambiguity to the
// agent instead of silently dropping it.
//
// Called from both places a recipient can see the documents:
//   - api/public/documents/verify/route.ts (password-protected shares,
//     on successful password check)
//   - app/docs/[token]/page.tsx (passwordless shares, on page render —
//     there's no client round-trip to hook for those)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';

interface DocRequestForTracking {
  id: string;
  account_id: string;
  requester_phone: string;
  viewed_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
}

// Collapses a reload/double-submit of the SAME open into one event —
// short enough that it can't mask a genuine later re-open (e.g. a
// forward opened minutes/hours afterward), long enough to absorb a
// page refresh or a resubmitted password form.
const SAME_SESSION_WINDOW_MS = 2 * 60 * 1000;

/**
 * Records that a shared document link was opened — every time, not
 * just the first. Best-effort throughout: a tracking failure must
 * never break the recipient's actual document access.
 *
 * Also resolves the requester's phone to an existing CRM contact in
 * this account and, if found, treats the open like any other inbound
 * interaction: bumps `last_contacted_at` (the field "Hot leads going
 * quiet" keys off) so a client who quietly opened your shared
 * documents doesn't read as a lead gone cold, and drops a note — worth
 * doing on every distinct open, since a second open days later is
 * exactly the "someone forwarded this" signal worth surfacing.
 */
export async function trackDocumentView(
  db: SupabaseClient,
  docRequest: DocRequestForTracking,
): Promise<void> {
  const now = Date.now();
  const withinSameSession = docRequest.last_viewed_at
    ? now - new Date(docRequest.last_viewed_at).getTime() < SAME_SESSION_WINDOW_MS
    : false;

  try {
    const isFirstView = !docRequest.viewed_at;
    const nowIso = new Date(now).toISOString();

    if (!withinSameSession) {
      await db
        .from('property_document_requests')
        .update({
          viewed_at: docRequest.viewed_at ?? nowIso,
          last_viewed_at: nowIso,
          view_count: docRequest.view_count + 1,
        })
        .eq('id', docRequest.id);
    }

    // A reload/resubmit within the same open — the view itself was
    // already counted moments ago; don't log the interaction twice.
    if (withinSameSession) return;

    const normalized = normalizePhoneWithCountryCode(docRequest.requester_phone, '91');
    if (!normalized) return;
    const cleanPhone = normalized.replace(/\D/g, '');

    const { data: contact } = await db
      .from('contacts')
      .select('id, user_id')
      .eq('account_id', docRequest.account_id)
      .or(`phone.eq.${docRequest.requester_phone},phone.eq.${normalized},phone.eq.${cleanPhone}`)
      .maybeSingle();

    if (!contact) return;

    await db.from('contacts').update({ last_contacted_at: nowIso }).eq('id', contact.id);

    const noteText = isFirstView
      ? '📂 Opened the shared property documents.'
      : `📂 Shared property documents opened again (view #${docRequest.view_count + 1}) — could be the original recipient re-opening, or the link forwarded to someone else.`;

    await db.from('contact_notes').insert({
      account_id: docRequest.account_id,
      contact_id: contact.id,
      user_id: contact.user_id,
      note_text: noteText,
    });
  } catch (err) {
    console.error('[trackDocumentView] failed (non-fatal):', err);
  }
}
