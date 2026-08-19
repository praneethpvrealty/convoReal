import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { writeJourneyEvent } from '@/lib/journey/events';

interface RequestBody {
  item_id?: string;
  message?: string;
  source?: 'web' | 'mobile';
}

function cleanMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function dedupeKey(args: {
  itemId: string;
  message: string;
  source: 'web' | 'mobile';
  userId: string | null;
}): string {
  return createHash('sha256')
    .update(
      `${args.itemId}|${args.source}|${args.userId ?? ''}|${args.message}`,
    )
    .digest('hex');
}

export async function POST(request: Request) {
  let accountId: string;
  let userId: string | null;
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];

  try {
    ({ accountId, userId, supabase } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const raw = (await request.json().catch(() => null)) as RequestBody | null;
    const itemId = typeof raw?.item_id === 'string' ? raw.item_id.trim() : '';
    const source = raw?.source === 'web' || raw?.source === 'mobile' ? raw.source : null;
    const message =
      typeof raw?.message === 'string' ? cleanMessage(raw.message) : '';

    if (!itemId || !message || !source) {
      return NextResponse.json(
        { error: 'item_id, message and source are required' },
        { status: 400 }
      );
    }

    const { data: item, error: itemError } = await supabase
      .from('journey_items')
      .select('id, contact_id, property_id')
      .eq('id', itemId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (itemError) {
      return NextResponse.json(
        { error: 'Failed to load journey item' },
        { status: 500 }
      );
    }
    if (!item) {
      return NextResponse.json({ error: 'Journey item not found' }, { status: 404 });
    }

    const normalized = cleanMessage(message);
    const key = dedupeKey({ itemId, message: normalized, source, userId });

    const outcome = await writeJourneyEvent({
      db: supabase,
      accountId,
      itemId,
      eventType: 'outbound_whatsapp',
      createdBy: userId,
      dedupeKey: key,
      metadata: {
        channel: 'personal_whatsapp',
        source,
        sender_type: 'agent',
        sender_id: userId,
        item_id: item.id,
        contact_id: item.contact_id,
        property_id: item.property_id,
        message: normalized,
        message_length: normalized.length,
      },
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error || 'Failed to log journey event' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, duplicate: outcome.duplicate, eventId: outcome.eventId });
  } catch (error) {
    console.error('[journey/events] failed', error);
    return NextResponse.json({ error: 'Failed to log journey event' }, { status: 500 });
  }
}

