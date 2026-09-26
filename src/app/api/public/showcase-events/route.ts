import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getCurrentAccount } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// POST /api/public/showcase-events
// Body: { account_id, session_key, ref?, events: [{ type, property_id?, metadata? }] }
//
// Public beacon for Showcase Pulse (migration 095). The showcase page is
// unauthenticated, so this endpoint is too — defenses instead of auth:
//   - per-session rate limit (a device can't flood)
//   - account existence check before any insert
//   - authenticated members viewing their own workspace are excluded
//   - `ref` (the contact the link was personalized for) is only recorded
//     when it resolves to a contact IN that account, and only for the
//     first device that opens the link — a forwarded link marks the
//     visitor as a guest referred by that contact, never as the contact
//   - batch capped, event types whitelisted, metadata size-clamped
// No IP or user-agent is stored.

function adminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const EVENT_TYPES = new Set([
  'open',
  'view_property',
  'map_click',
  'gallery',
  'search',
]);
const MAX_BATCH = 20;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEACON_LIMIT = { limit: 60, windowMs: 60_000 };

interface BeaconEvent {
  type?: string;
  property_id?: string;
  metadata?: Record<string, unknown>;
}

async function isInternalViewer(accountId: string): Promise<boolean> {
  try {
    const context = await getCurrentAccount();
    return context.accountId === accountId;
  } catch {
    return false;
  }
}

function sanitizeMetadata(event: BeaconEvent): Record<string, unknown> | null {
  if (event.type === 'search') {
    if (typeof event.metadata?.query !== 'string') return null;
    const query = event.metadata.query
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    return query ? { query } : null;
  }

  if (!event.metadata || typeof event.metadata !== 'object') return {};
  return JSON.stringify(event.metadata).length <= 1000 ? event.metadata : {};
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      account_id?: string;
      session_key?: string;
      ref?: string;
      share_id?: string;
      events?: BeaconEvent[];
    } | null;

    const accountId = body?.account_id;
    const sessionKey = (body?.session_key || '').slice(0, 64);
    const events = Array.isArray(body?.events)
      ? body!.events!.slice(0, MAX_BATCH)
      : [];

    if (
      !accountId ||
      !UUID_RE.test(accountId) ||
      !sessionKey ||
      events.length === 0
    ) {
      // Beacons are fire-and-forget on the client — 204 either way keeps
      // the console clean; genuinely malformed input is just dropped.
      return new NextResponse(null, { status: 204 });
    }

    const limit = await checkRateLimit(
      `showcase-beacon:${sessionKey}`,
      BEACON_LIMIT
    );
    if (!limit.success) return rateLimitResponse(limit);

    if (await isInternalViewer(accountId)) {
      return new NextResponse(null, { status: 204 });
    }

    const db = adminClient();

    const { data: account } = await db
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account) return new NextResponse(null, { status: 204 });

    // Resolve ref → contact through resolve_showcase_visitor (migration
    // 20260926130000): the contact must belong to this account, a
    // session already known as someone's device keeps that identity,
    // and a personalized link is claimed by the first device that opens
    // it. Any later device presenting the same ref is a forwarded viewer
    // — its events carry via_contact_id instead of contact_id.
    const ref = body?.ref && UUID_RE.test(body.ref) ? body.ref : null;
    let contactId: string | null = null;
    let viaContactId: string | null = null;
    const { data: identity, error: identityError } = await db.rpc(
      'resolve_showcase_visitor',
      {
        p_account_id: accountId,
        p_session_key: sessionKey,
        p_contact_id: ref,
      }
    );
    if (identityError) {
      console.error(
        '[showcase-events] identity resolve failed:',
        identityError.message
      );
    } else {
      const resolved = (Array.isArray(identity) ? identity[0] : identity) as {
        contact_id: string | null;
        via_contact_id: string | null;
      } | null;
      contactId = resolved?.contact_id ?? null;
      viaContactId = resolved?.via_contact_id ?? null;
    }

    // Resolve the share-instance token (?s= on generic showcase shares,
    // migration 173) with the same tenancy rule as ref: a forged id
    // from another account must never label this account's events.
    let shareId: string | null = null;
    if (body?.share_id && UUID_RE.test(body.share_id)) {
      const { data: share } = await db
        .from('showcase_share_links')
        .select('id')
        .eq('id', body.share_id)
        .eq('account_id', accountId)
        .maybeSingle();
      shareId = share?.id ?? null;
    }

    const rows = events
      .filter((e) => e && typeof e.type === 'string' && EVENT_TYPES.has(e.type))
      .map((e) => ({ event: e, metadata: sanitizeMetadata(e) }))
      .filter(
        (
          entry
        ): entry is { event: BeaconEvent; metadata: Record<string, unknown> } =>
          entry.metadata !== null
      )
      .map(({ event, metadata }) => ({
        account_id: accountId,
        contact_id: contactId,
        via_contact_id: viaContactId,
        property_id:
          typeof event.property_id === 'string' &&
          UUID_RE.test(event.property_id)
            ? event.property_id
            : null,
        session_key: sessionKey,
        share_id: shareId,
        event_type: event.type,
        metadata,
      }));

    if (rows.length > 0) {
      const { error } = await db.from('showcase_events').insert(rows);
      if (error)
        console.error('[showcase-events] insert failed:', error.message);
    }

    // Retroactive stitching: the session_key persists in the visitor's
    // localStorage, so once a session is ever identified (it claimed a
    // personalized v= link, or is a known device), earlier anonymous
    // events from the same device inherit that identity. Only null rows
    // are touched — a session already attributed to another contact is
    // never rewritten, and a forwarded viewer is never stitched.
    if (contactId) {
      const { error } = await db
        .from('showcase_events')
        .update({ contact_id: contactId })
        .eq('account_id', accountId)
        .eq('session_key', sessionKey)
        .is('contact_id', null);
      if (error)
        console.error('[showcase-events] stitch failed:', error.message);
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[POST /api/public/showcase-events] Error:', err);
    return new NextResponse(null, { status: 204 });
  }
}
