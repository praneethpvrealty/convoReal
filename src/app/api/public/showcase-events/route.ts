import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// POST /api/public/showcase-events
// Body: { account_id, session_key, ref?, events: [{ type, property_id?, metadata? }] }
//
// Public beacon for Showcase Pulse (migration 095). The showcase page is
// unauthenticated, so this endpoint is too — defenses instead of auth:
//   - per-session rate limit (a device can't flood)
//   - account existence check before any insert
//   - `ref` (the contact the link was personalized for) is only recorded
//     when it resolves to a contact IN that account
//   - batch capped, event types whitelisted, metadata size-clamped
// No IP or user-agent is stored.

function adminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const EVENT_TYPES = new Set(['open', 'view_property', 'map_click', 'gallery']);
const MAX_BATCH = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEACON_LIMIT = { limit: 60, windowMs: 60_000 };

interface BeaconEvent {
  type?: string;
  property_id?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      account_id?: string;
      session_key?: string;
      ref?: string;
      events?: BeaconEvent[];
    } | null;

    const accountId = body?.account_id;
    const sessionKey = (body?.session_key || '').slice(0, 64);
    const events = Array.isArray(body?.events) ? body!.events!.slice(0, MAX_BATCH) : [];

    if (!accountId || !UUID_RE.test(accountId) || !sessionKey || events.length === 0) {
      // Beacons are fire-and-forget on the client — 204 either way keeps
      // the console clean; genuinely malformed input is just dropped.
      return new NextResponse(null, { status: 204 });
    }

    const limit = checkRateLimit(`showcase-beacon:${sessionKey}`, BEACON_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const db = adminClient();

    const { data: account } = await db
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account) return new NextResponse(null, { status: 204 });

    // Resolve ref → contact, but only within this account: a forged ref
    // from another tenant must never attach events to a foreign contact.
    let contactId: string | null = null;
    if (body?.ref && UUID_RE.test(body.ref)) {
      const { data: contact } = await db
        .from('contacts')
        .select('id')
        .eq('id', body.ref)
        .eq('account_id', accountId)
        .maybeSingle();
      contactId = contact?.id ?? null;
    }

    const rows = events
      .filter((e) => e && typeof e.type === 'string' && EVENT_TYPES.has(e.type))
      .map((e) => ({
        account_id: accountId,
        contact_id: contactId,
        property_id:
          typeof e.property_id === 'string' && UUID_RE.test(e.property_id)
            ? e.property_id
            : null,
        session_key: sessionKey,
        event_type: e.type,
        // Oversized metadata is dropped whole rather than truncated —
        // slicing serialized JSON yields invalid JSON.
        metadata:
          e.metadata &&
          typeof e.metadata === 'object' &&
          JSON.stringify(e.metadata).length <= 1000
            ? e.metadata
            : {},
      }));

    if (rows.length > 0) {
      const { error } = await db.from('showcase_events').insert(rows);
      if (error) console.error('[showcase-events] insert failed:', error.message);
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[POST /api/public/showcase-events] Error:', err);
    return new NextResponse(null, { status: 204 });
  }
}
