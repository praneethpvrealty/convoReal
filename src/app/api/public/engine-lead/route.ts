import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import { assignTagsToContact } from '@/app/api/leads/email-webhook/db-utils';

// POST /api/public/engine-lead
// ConvoReal's OWN prospect funnel. A real-estate pro interested in the
// Engine qualifies themselves; they're captured as a tagged contact in
// ConvoReal's master account (dogfooding — we run our sales pipeline on
// our own product) and handed off to sales on WhatsApp.
//
// Two entry points feed it: the marketing site, and the lead bot on
// every customer showcase — those portals are browsed by agents and
// builders all day, and a co-broker poking around someone's inventory
// is exactly our buyer. `source` keeps the two apart in the pipeline.
//
// Target account + sales number come from env, never hardcoded:
//   CONVOREAL_MASTER_ACCOUNT_ID — account prospects land in.
// The sales WhatsApp number is that account's showcase contact_phone.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_LIMIT = { limit: 5, windowMs: 60_000 };
const GLOBAL_LIMIT = { limit: 60, windowMs: 60_000 };

// Role → Engine classification. Builders/developers are Developers;
// everyone else evaluating the Engine is an Agent.
function roleToClassification(role: string): string {
  const r = role.toLowerCase();
  if (r.includes('builder') || r.includes('developer')) return 'Developer';
  return 'Agent';
}

export async function POST(request: NextRequest) {
  try {
    const masterAccountId = process.env.CONVOREAL_MASTER_ACCOUNT_ID;

    const body = (await request.json().catch(() => null)) as {
      name?: string;
      phone?: string;
      role?: string;
      city?: string;
      team_size?: string;
      session_key?: string;
      source?: string;
      /** Showcase the prospect was browsing when the bot qualified them. */
      source_account_id?: string;
      /** Why an /i/<token> visitor landed on the waitlist rather than a
       *  live seat — 'expired' | 'used' | 'revoked' | 'program_full'. */
      invite_state?: string;
    } | null;

    const name = (body?.name || '').trim().slice(0, 120);
    const rawPhone = (body?.phone || '').trim();
    const role = (body?.role || '').trim().slice(0, 60);
    const city = (body?.city || '').trim().slice(0, 80);
    const teamSize = (body?.team_size || '').trim().slice(0, 40);
    const sessionKey = (body?.session_key || '').slice(0, 64);
    const fromShowcase = body?.source === 'showcase';
    // A visitor who reached a spent or expired /i/<token> link. These
    // are the warmest leads the invite programme produces — an
    // invite-only launch generates forwarded links by design — so they
    // land in the same pipeline rather than hitting a wall.
    const fromWaitlist = body?.source === 'beta_waitlist';
    const inviteState = (body?.invite_state || '').trim().slice(0, 40);
    const sourceAccountId =
      fromShowcase && body?.source_account_id && UUID_RE.test(body.source_account_id)
        ? body.source_account_id
        : null;

    if (!rawPhone) {
      return NextResponse.json({ error: 'Please share your WhatsApp number.' }, { status: 400 });
    }
    const phone = normalizePhoneWithCountryCode(rawPhone);
    if (!phone) {
      return NextResponse.json({ error: 'That number looks off — please re-enter it with your area code.' }, { status: 400 });
    }

    // Rate limits — per session, then global (this funnel targets one
    // account, so the global cap protects it from flooding).
    if (sessionKey) {
      const s = checkRateLimit(`enginelead:session:${sessionKey}`, SESSION_LIMIT);
      if (!s.success) return rateLimitResponse(s);
    }
    const g = checkRateLimit('enginelead:global', GLOBAL_LIMIT);
    if (!g.success) return rateLimitResponse(g);

    // If the funnel isn't configured yet, don't hard-fail the visitor —
    // return success so the UI still shows the WhatsApp handoff.
    if (!masterAccountId || !UUID_RE.test(masterAccountId)) {
      console.warn('[POST /api/public/engine-lead] CONVOREAL_MASTER_ACCOUNT_ID not configured — skipping capture.');
      return NextResponse.json({ success: true, captured: false, whatsappLink: null });
    }

    const db = supabaseAdmin();

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', masterAccountId)
      .maybeSingle();
    if (!account?.owner_user_id) {
      console.error('[POST /api/public/engine-lead] master account not found or has no owner.');
      return NextResponse.json({ success: true, captured: false, whatsappLink: null });
    }
    const userId = account.owner_user_id as string;

    let contactId: string;
    try {
      const result = await findOrCreateContact(db, {
        accountId: masterAccountId,
        userId,
        phone,
        name: name || 'Engine Prospect',
        classification: roleToClassification(role),
        referrer: fromWaitlist
          ? 'ConvoReal Beta Waitlist'
          : fromShowcase
            ? 'ConvoReal Showcase Bot'
            : 'ConvoReal Website',
        company: role || null,
      });
      contactId = result.contactId;
    } catch (err) {
      console.error('[POST /api/public/engine-lead] contact create failed:', err);
      return NextResponse.json({ success: true, captured: false, whatsappLink: null });
    }

    // Tag for easy pipeline filtering.
    const tags = ['ConvoReal Prospect'];
    if (fromWaitlist) tags.push('Beta Waitlist');
    if (fromShowcase) tags.push('Showcase Referral');
    if (role) tags.push(role);
    if (city) tags.push(city);
    try {
      await assignTagsToContact(db, masterAccountId, userId, contactId, tags);
    } catch (err) {
      console.error('[POST /api/public/engine-lead] tagging failed (non-fatal):', err);
    }

    // Qualification note. A showcase prospect is worth more with the
    // portal they came from attached — that's a live reference account
    // and often a co-broking relationship sales can open with.
    let foundOn: string | null = null;
    if (sourceAccountId) {
      const { data: sourceAccount } = await db
        .from('accounts')
        .select('name')
        .eq('id', sourceAccountId)
        .maybeSingle();
      foundOn = (sourceAccount?.name as string | undefined) || sourceAccountId;
    }

    const noteLines = [
      fromWaitlist
        ? 'Beta waitlist signup (reached an invite link they could not use):'
        : fromShowcase
          ? 'New ConvoReal prospect (via a customer showcase):'
          : 'New ConvoReal website prospect:',
      fromWaitlist && inviteState ? `• Invite link state: ${inviteState}` : null,
      foundOn ? `• Found on: ${foundOn}'s showcase` : null,
      role ? `• Role: ${role}` : null,
      city ? `• City: ${city}` : null,
      teamSize ? `• Team size: ${teamSize}` : null,
    ].filter(Boolean);
    try {
      await db.from('contact_notes').insert({
        account_id: masterAccountId,
        contact_id: contactId,
        user_id: userId,
        note_text: noteLines.join('\n'),
      });
    } catch (err) {
      console.error('[POST /api/public/engine-lead] note insert failed (non-fatal):', err);
    }

    // Resolve the sales WhatsApp number from the master account's
    // showcase settings so the handoff button works.
    const { data: settings } = await db
      .from('showcase_settings')
      .select('contact_phone')
      .eq('account_id', masterAccountId)
      .maybeSingle();
    const salesPhone = (settings?.contact_phone || '').replace(/\D/g, '');
    const whatsappLink = salesPhone
      ? `https://wa.me/${salesPhone}?text=${encodeURIComponent(
          `Hi! I'm interested in ConvoReal${role ? ` (${role}${city ? `, ${city}` : ''})` : ''}.`,
        )}`
      : null;

    return NextResponse.json({ success: true, captured: true, whatsappLink });
  } catch (err) {
    console.error('[POST /api/public/engine-lead] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
