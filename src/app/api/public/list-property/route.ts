import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { generateSubmissionCode } from '@/lib/showcase/listing-verification';

// POST /api/public/list-property
// Public "List your property" submission for the seller funnel.
//
// Stashes the seller's raw listing (text + already-uploaded photo
// URLs) with a short verification code and returns a wa.me link. The
// seller sends the code to the agent's WhatsApp; the inbound webhook
// (listing-verification.ts) matches it, verifies number ownership, and
// only THEN parses + creates a Pending-Review property. No AI is called
// here, so unverified submissions cost the agent nothing.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_TEXT_LEN = 15;
const MAX_TEXT_LEN = 5000;
const MAX_IMAGES = 15;

// Bounds abuse: a device can only stash a handful of submissions/min,
// and an account can't be flooded with pending rows.
const SESSION_LIMIT = { limit: 5, windowMs: 60_000 };
const ACCOUNT_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      account_id?: string;
      raw_text?: string;
      images?: unknown;
      submitter_name?: string;
      session_key?: string;
    } | null;

    const accountId = body?.account_id;
    const rawText = (body?.raw_text || '').trim();
    const sessionKey = (body?.session_key || '').slice(0, 64);
    const submitterName = (body?.submitter_name || '').trim().slice(0, 120) || null;

    if (!accountId || !UUID_RE.test(accountId)) {
      return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
    }
    if (rawText.length < MIN_TEXT_LEN) {
      return NextResponse.json({ error: 'Please add more details about your property.' }, { status: 400 });
    }
    if (rawText.length > MAX_TEXT_LEN) {
      return NextResponse.json({ error: 'That is a lot of text — please shorten it a little.' }, { status: 400 });
    }

    // Only accept image URLs from our own storage (uploaded via the
    // companion upload route) — never arbitrary attacker-supplied URLs.
    const storageHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
    const images = Array.isArray(body?.images)
      ? (body!.images as unknown[])
          .filter((u): u is string => typeof u === 'string')
          .filter((u) => {
            try {
              return new URL(u).host === storageHost;
            } catch {
              return false;
            }
          })
          .slice(0, MAX_IMAGES)
      : [];

    // Rate limits — per session, then per account.
    if (sessionKey) {
      const s = checkRateLimit(`list:session:${sessionKey}`, SESSION_LIMIT);
      if (!s.success) return rateLimitResponse(s);
    }
    const a = checkRateLimit(`list:account:${accountId}`, ACCOUNT_LIMIT);
    if (!a.success) return rateLimitResponse(a);

    const db = supabaseAdmin();

    // Account must exist and have a public WhatsApp number to receive
    // the verification message.
    const { data: settings } = await db
      .from('showcase_settings')
      .select('contact_phone')
      .eq('account_id', accountId)
      .maybeSingle();

    const contactPhone = (settings?.contact_phone || '').replace(/\D/g, '');
    if (!contactPhone) {
      return NextResponse.json(
        { error: 'This agent is not set up to receive listings yet.' },
        { status: 409 },
      );
    }

    // Insert with a unique code, retrying on the rare collision.
    let code = generateSubmissionCode();
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const { error } = await db.from('public_listing_submissions').insert({
        account_id: accountId,
        code,
        raw_text: rawText,
        images,
        submitter_name: submitterName,
      });
      if (!error) {
        inserted = true;
        break;
      }
      // 23505 = unique_violation on (account_id, code) → new code, retry.
      if (error.code === '23505') {
        code = generateSubmissionCode();
        continue;
      }
      console.error('[POST /api/public/list-property] insert failed:', error);
      return NextResponse.json({ error: 'Could not submit your listing. Please try again.' }, { status: 500 });
    }
    if (!inserted) {
      return NextResponse.json({ error: 'Could not submit your listing. Please try again.' }, { status: 500 });
    }

    const message = `Hi! I'd like to list my property. My verification code is ${code}`;
    const whatsappLink = `https://wa.me/${contactPhone}?text=${encodeURIComponent(message)}`;

    return NextResponse.json({ code, whatsappLink, expiresInHours: 24 });
  } catch (err) {
    console.error('[POST /api/public/list-property] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
