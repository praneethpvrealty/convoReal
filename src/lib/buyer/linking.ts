// ============================================================
// Buyer portal — identity completion & contact linking.
//
// Called by POST /api/buyer/auth/complete after either login flow
// ends with a VERIFIED phone on auth.users (WhatsApp OTP login
// verifies it inherently; Google logins verify via the
// /buyer/verify-phone phone_change OTP). Creates/refreshes the
// buyer_users row, links it to every tenant's contact that matches
// the phone AND looks like a buyer (see find_buyer_contacts,
// migration 160), then seeds the shortlist from contact-attributed
// showcase ratings/likes.
//
// Linking is idempotent and re-run lazily on each login — an agency
// may have added the buyer as a lead (or the buyer may have rated
// properties through a share link) since the previous session.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { buyerAdmin, type BuyerContactLink } from './auth';

/** Same bar as the showcase rating endpoint's priority-inquiry rule. */
const SHORTLIST_SEED_MIN_RATING = 7;

export interface CompleteBuyerAuthResult {
  buyerUserId: string;
  phone: string;
  links: BuyerContactLink[];
  /** True when this call created the buyer_users row (first completion). */
  isNewBuyerUser: boolean;
}

export async function completeBuyerAuth(args: {
  authUserId: string;
  /** Verified phone from auth.users (E.164-ish). */
  phone: string;
  displayName?: string | null;
}): Promise<CompleteBuyerAuthResult> {
  const db = buyerAdmin();
  const phone = args.phone;
  const digits = normalizePhone(phone);
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;

  const { data: existing } = await db
    .from('buyer_users')
    .select('id, display_name')
    .eq('auth_user_id', args.authUserId)
    .maybeSingle();

  let buyerUserId: string;
  if (existing) {
    buyerUserId = existing.id as string;
    await db
      .from('buyer_users')
      .update({
        phone,
        phone_normalized: last10,
        ...(args.displayName && !existing.display_name
          ? { display_name: args.displayName }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', buyerUserId);
  } else {
    const { data: created, error: createErr } = await db
      .from('buyer_users')
      .insert({
        auth_user_id: args.authUserId,
        phone,
        phone_normalized: last10,
        display_name: args.displayName || null,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      // A racing completion (double-submit) may have inserted first —
      // unique(auth_user_id) makes the loser safe to re-read.
      const { data: raced } = await db
        .from('buyer_users')
        .select('id')
        .eq('auth_user_id', args.authUserId)
        .maybeSingle();
      if (!raced) {
        console.error(
          '[completeBuyerAuth] buyer_users insert failed:',
          createErr
        );
        throw new Error('Could not create buyer profile');
      }
      buyerUserId = raced.id as string;
    } else {
      buyerUserId = created.id as string;
    }
  }

  const { data: matches, error: matchErr } = await db.rpc(
    'find_buyer_contacts',
    {
      p_phone_last10: last10,
    }
  );
  if (matchErr) {
    console.error('[completeBuyerAuth] find_buyer_contacts failed:', matchErr);
  }

  if (matches && matches.length > 0) {
    const rows = (
      matches as Array<{ contact_id: string; account_id: string }>
    ).map((m) => ({
      buyer_user_id: buyerUserId,
      account_id: m.account_id,
      contact_id: m.contact_id,
      phone_at_link: phone,
    }));
    // Idempotent: existing (buyer_user, contact) pairs are left
    // untouched (including any an admin marked 'revoked' — upsert with
    // ignoreDuplicates never resurrects them).
    const { error: linkErr } = await db
      .from('buyer_contact_links')
      .upsert(rows, {
        onConflict: 'buyer_user_id,contact_id',
        ignoreDuplicates: true,
      });
    if (linkErr) {
      console.error('[completeBuyerAuth] link upsert failed:', linkErr);
    }
  }

  const { data: linkRows } = await db
    .from('buyer_contact_links')
    .select('id, account_id, contact_id, account:accounts(id, name)')
    .eq('buyer_user_id', buyerUserId)
    .eq('status', 'active');

  const links: BuyerContactLink[] = (linkRows || []).map((row) => {
    const account = Array.isArray(row.account) ? row.account[0] : row.account;
    return {
      linkId: row.id as string,
      accountId: row.account_id as string,
      contactId: row.contact_id as string,
      agencyName: (account as { name?: string } | null)?.name ?? null,
    };
  });

  await seedShortlistFromInterest(buyerUserId, links);

  return { buyerUserId, phone, links, isNewBuyerUser: !existing };
}

/**
 * Pull the buyer's contact-attributed showcase interest (ratings ≥ 7
 * and likes) into buyer_shortlist_items so the portal shortlist is
 * never empty on first login. ignoreDuplicates keeps manual removals
 * and re-logins from resurrecting or duplicating rows.
 */
async function seedShortlistFromInterest(
  buyerUserId: string,
  links: BuyerContactLink[]
): Promise<void> {
  if (links.length === 0) return;
  const db = buyerAdmin();
  const contactIds = links.map((l) => l.contactId);
  const contactToAccount = new Map(
    links.map((l) => [l.contactId, l.accountId])
  );

  const [{ data: ratings }, { data: likes }] = await Promise.all([
    db
      .from('property_ratings')
      .select('property_id, contact_id, rating')
      .in('contact_id', contactIds)
      .gte('rating', SHORTLIST_SEED_MIN_RATING),
    db
      .from('property_likes')
      .select('property_id, contact_id')
      .in('contact_id', contactIds),
  ]);

  const rows = new Map<string, Record<string, unknown>>();
  for (const like of likes || []) {
    rows.set(like.property_id as string, {
      buyer_user_id: buyerUserId,
      account_id: contactToAccount.get(like.contact_id as string),
      property_id: like.property_id,
      contact_id: like.contact_id,
      source: 'like',
    });
  }
  for (const rating of ratings || []) {
    rows.set(rating.property_id as string, {
      buyer_user_id: buyerUserId,
      account_id: contactToAccount.get(rating.contact_id as string),
      property_id: rating.property_id,
      contact_id: rating.contact_id,
      source: 'rating',
    });
  }

  const inserts = [...rows.values()].filter((r) => r.account_id);
  if (inserts.length === 0) return;

  const { error } = await db
    .from('buyer_shortlist_items')
    .upsert(inserts, {
      onConflict: 'buyer_user_id,property_id',
      ignoreDuplicates: true,
    });
  if (error) {
    console.error(
      '[seedShortlistFromInterest] upsert failed (non-fatal):',
      error
    );
  }
}
