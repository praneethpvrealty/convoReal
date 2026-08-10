// ============================================================
// DELETE /api/den/account
//
// Self-service deletion of an Owners Den login. Den signup happens
// inside the mobile app (app/(auth)/den-login.tsx creates users), so
// App Store Guideline 5.1.1(v) requires deleting one there too. The
// staff counterpart is DELETE /api/account/delete.
//
// What goes: the den_users row (den_contact_links CASCADE off it) and
// the auth user. What stays: the tenant-scoped `contacts` rows the
// links pointed at — those are the agency's CRM records, not the
// owner's account. Their WhatsApp digest consent is revoked on the
// way out so a deleted owner stops receiving messages, matching the
// lockstep the settings route keeps between the two channels.
// ============================================================

import { NextResponse } from 'next/server';

import { UserFacingError } from '@/lib/auth/account';
import { withDenAuth, denAdmin } from '@/lib/den/auth';

export const DELETE = withDenAuth(async (ctx, req) => {
  const body = (await req.json().catch(() => null)) as {
    confirm?: unknown;
  } | null;
  if (body?.confirm !== 'DELETE') {
    throw new UserFacingError(
      'Send { confirm: "DELETE" } to confirm account deletion'
    );
  }

  const db = denAdmin();

  if (ctx.links.length > 0) {
    const { error: consentErr } = await db
      .from('contacts')
      .update({
        owner_digest_consent: 'declined',
        updated_at: new Date().toISOString(),
      })
      .in(
        'id',
        ctx.links.map((l) => l.contactId)
      );
    if (consentErr) {
      console.error(
        '[den/account DELETE] consent revoke failed (non-fatal):',
        consentErr
      );
    }
  }

  const { error: denErr } = await db
    .from('den_users')
    .delete()
    .eq('id', ctx.denUserId);
  if (denErr) {
    console.error('[den/account DELETE] den_users delete failed:', denErr);
    return NextResponse.json(
      { error: 'Could not delete your account' },
      { status: 500 }
    );
  }

  const { error: authErr } = await db.auth.admin.deleteUser(ctx.userId);
  if (authErr) {
    console.error('[den/account DELETE] auth user delete failed:', authErr);
    return NextResponse.json(
      { error: 'Could not delete your login' },
      { status: 500 }
    );
  }

  console.log(`[den/account DELETE] den user ${ctx.denUserId} deleted`);

  return NextResponse.json({ ok: true });
});
