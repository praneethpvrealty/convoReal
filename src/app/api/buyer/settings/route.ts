// ============================================================
// /api/buyer/settings — the buyer's notification preferences.
//
// alerts_enabled doubles as WhatsApp alert consent: turning it off
// writes buyer_alerts_consent='declined' on every linked contact,
// turning it on writes 'granted' — so the portal setting and the
// WhatsApp STOP ALERTS/START ALERTS commands always agree (both
// channels edit the same contacts column; see
// applyBuyerAlertsCommand).
// ============================================================

import { NextResponse } from 'next/server';

import { UserFacingError } from '@/lib/auth/account';
import { withBuyerAuth, buyerAdmin } from '@/lib/buyer/auth';

export const GET = withBuyerAuth(async (ctx) => {
  let alertsEnabled = true;
  if (ctx.links.length > 0) {
    const { data } = await buyerAdmin()
      .from('contacts')
      .select('buyer_alerts_consent')
      .in(
        'id',
        ctx.links.map((l) => l.contactId)
      );
    alertsEnabled = (data || []).every(
      (c) => c.buyer_alerts_consent !== 'declined'
    );
  }

  return NextResponse.json({
    display_name: ctx.displayName,
    notify_matches: ctx.notifyMatches,
    alerts_enabled: alertsEnabled,
  });
});

export const PUT = withBuyerAuth(async (ctx, req) => {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) throw new UserFacingError('Invalid request body');

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.display_name === 'string') {
    update.display_name = body.display_name.trim().slice(0, 120) || null;
  }
  if (typeof body.notify_matches === 'boolean')
    update.notify_matches = body.notify_matches;

  const db = buyerAdmin();
  const { error } = await db
    .from('buyer_users')
    .update(update)
    .eq('id', ctx.buyerUserId);
  if (error) {
    console.error('[buyer/settings PUT] update failed:', error);
    return NextResponse.json(
      { error: 'Could not save settings' },
      { status: 500 }
    );
  }

  // Keep WhatsApp alert consent in lockstep on every linked contact.
  if (typeof body.alerts_enabled === 'boolean' && ctx.links.length > 0) {
    const consent = body.alerts_enabled ? 'granted' : 'declined';
    const { error: consentErr } = await db
      .from('contacts')
      .update({
        buyer_alerts_consent: consent,
        updated_at: new Date().toISOString(),
      })
      .in(
        'id',
        ctx.links.map((l) => l.contactId)
      );
    if (consentErr) {
      console.error(
        '[buyer/settings PUT] consent sync failed (non-fatal):',
        consentErr
      );
    }
  }

  return NextResponse.json({ success: true });
});
