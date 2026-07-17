// ============================================================
// Owners Den — identity completion & contact linking.
//
// Called by POST /api/den/auth/complete after either login flow ends
// with a VERIFIED phone on auth.users (WhatsApp OTP login verifies it
// inherently; Google logins verify via the /den/verify-phone
// phone_change OTP). Creates/refreshes the den_users row and links it
// to every tenant's contact that matches the phone AND looks like a
// property owner (see find_den_owner_contacts, migration 132).
//
// Linking is idempotent and re-run lazily on each login — an agency
// may have added the owner as a contact (or attached properties to
// them) since the previous session.
// ============================================================

import { normalizePhone } from "@/lib/whatsapp/phone-utils";
import { denAdmin, type DenContactLink } from "./auth";

export interface CompleteDenAuthResult {
  denUserId: string;
  phone: string;
  links: DenContactLink[];
  /** True when this call created the den_users row (first completion). */
  isNewDenUser: boolean;
}

export async function completeDenAuth(args: {
  authUserId: string;
  /** Verified phone from auth.users (E.164-ish). */
  phone: string;
  displayName?: string | null;
}): Promise<CompleteDenAuthResult> {
  const db = denAdmin();
  const phone = args.phone;
  const digits = normalizePhone(phone);
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;

  const { data: existing } = await db
    .from("den_users")
    .select("id, display_name")
    .eq("auth_user_id", args.authUserId)
    .maybeSingle();

  let denUserId: string;
  if (existing) {
    denUserId = existing.id as string;
    await db
      .from("den_users")
      .update({
        phone,
        phone_normalized: last10,
        // Never blank out a name the owner already set.
        ...(args.displayName && !existing.display_name
          ? { display_name: args.displayName }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", denUserId);
  } else {
    const { data: created, error: createErr } = await db
      .from("den_users")
      .insert({
        auth_user_id: args.authUserId,
        phone,
        phone_normalized: last10,
        display_name: args.displayName || null,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      // A racing completion (double-submit) may have inserted first —
      // unique(auth_user_id) makes the loser safe to re-read.
      const { data: raced } = await db
        .from("den_users")
        .select("id")
        .eq("auth_user_id", args.authUserId)
        .maybeSingle();
      if (!raced) {
        console.error("[completeDenAuth] den_users insert failed:", createErr);
        throw new Error("Could not create Owners Den profile");
      }
      denUserId = raced.id as string;
    } else {
      denUserId = created.id as string;
    }
  }

  // Owner-contact discovery across ALL tenant accounts (service-role
  // RPC — digit-normalized matching happens in SQL).
  const { data: matches, error: matchErr } = await db.rpc("find_den_owner_contacts", {
    p_phone_last10: last10,
  });
  if (matchErr) {
    console.error("[completeDenAuth] find_den_owner_contacts failed:", matchErr);
  }

  if (matches && matches.length > 0) {
    const rows = (matches as Array<{ contact_id: string; account_id: string }>).map((m) => ({
      den_user_id: denUserId,
      account_id: m.account_id,
      contact_id: m.contact_id,
      phone_at_link: phone,
    }));
    // Idempotent: existing (den_user, contact) pairs are left untouched
    // (including any an admin marked 'revoked' — upsert with
    // ignoreDuplicates never resurrects them).
    const { error: linkErr } = await db
      .from("den_contact_links")
      .upsert(rows, { onConflict: "den_user_id,contact_id", ignoreDuplicates: true });
    if (linkErr) {
      console.error("[completeDenAuth] link upsert failed:", linkErr);
    }
  }

  const { data: linkRows } = await db
    .from("den_contact_links")
    .select("id, account_id, contact_id, account:accounts(id, name)")
    .eq("den_user_id", denUserId)
    .eq("status", "active");

  const links: DenContactLink[] = (linkRows || []).map((row) => {
    const account = Array.isArray(row.account) ? row.account[0] : row.account;
    return {
      linkId: row.id as string,
      accountId: row.account_id as string,
      contactId: row.contact_id as string,
      agencyName: (account as { name?: string } | null)?.name ?? null,
    };
  });

  return { denUserId, phone, links, isNewDenUser: !existing };
}
