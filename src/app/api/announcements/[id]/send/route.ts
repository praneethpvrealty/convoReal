import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import {
  accumulateSendCounts,
  announcementDeliveryFor,
  emptySendCounts,
  isUpdateChannel,
  type UpdateChannel,
} from '@/lib/voice/announcements';

const MAX_BATCH = 100;
const LOOKUP_CHUNK = 100;

// POST /api/announcements/[id]/send — deliver the announcement to the
// given contacts, per-recipient channel chosen from their stated
// preference (sender default when unstated), inside the 24-hour
// window only. voice_call-preference contacts are skipped and counted
// — the call path rides the campaign dispatcher, not this route.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `agent:sendAnnouncement:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const contactIds = Array.isArray(body?.contact_ids)
      ? [
          ...new Set(
            body.contact_ids.filter(
              (i: unknown): i is string => typeof i === 'string'
            )
          ),
        ]
      : [];
    if (contactIds.length === 0 || contactIds.length > MAX_BATCH) {
      return NextResponse.json(
        {
          error: `contact_ids must be a non-empty array of at most ${MAX_BATCH} ids`,
        },
        { status: 400 }
      );
    }
    const senderDefault =
      body?.default_channel === 'whatsapp_text'
        ? 'whatsapp_text'
        : 'whatsapp_audio';

    const { data: announcement } = await ctx.supabase
      .from('voice_announcements')
      .select('id, body_text, status, audio_url, sent_counts')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (!announcement) {
      return NextResponse.json(
        { error: 'Announcement not found' },
        { status: 404 }
      );
    }
    if (announcement.status !== 'ready' || !announcement.audio_url) {
      return NextResponse.json(
        {
          error:
            'The voice note is not ready yet — wait for generation to finish.',
        },
        { status: 409 }
      );
    }

    // Chunked .in() — an unbounded id list travels in the URL (§2.6).
    const contacts: {
      id: string;
      preferred_update_channel: string | null;
    }[] = [];
    const windows = new Map<string, string | null>();
    for (let i = 0; i < contactIds.length; i += LOOKUP_CHUNK) {
      const chunk = contactIds.slice(i, i + LOOKUP_CHUNK);
      const { data: rows } = await ctx.supabase
        .from('contacts')
        .select('id, preferred_update_channel')
        .eq('account_id', ctx.accountId)
        .in('id', chunk)
        .not('phone', 'is', null)
        .eq('is_merged', false);
      contacts.push(...(rows ?? []));
      const { data: convos } = await ctx.supabase
        .from('conversations')
        .select('contact_id, last_customer_message_at')
        .eq('account_id', ctx.accountId)
        .in('contact_id', chunk);
      for (const c of convos ?? []) {
        windows.set(c.contact_id, c.last_customer_message_at);
      }
    }

    const counts = emptySendCounts();
    for (const contact of contacts) {
      const preference: UpdateChannel | null = isUpdateChannel(
        contact.preferred_update_channel
      )
        ? contact.preferred_update_channel
        : null;
      const delivery = announcementDeliveryFor(
        preference,
        senderDefault,
        isWithinCustomerWindow(windows.get(contact.id))
      );
      if (delivery === 'skipped_voice_pref' || delivery === 'skipped_window') {
        counts[delivery]++;
        continue;
      }
      const result = await sendWhatsAppMessageAndPersist(
        delivery === 'audio'
          ? {
              accountId: ctx.accountId,
              userId: ctx.userId,
              contactId: contact.id,
              kind: 'media',
              senderType: 'user',
              mediaKind: 'audio',
              mediaLink: announcement.audio_url,
            }
          : {
              accountId: ctx.accountId,
              userId: ctx.userId,
              contactId: contact.id,
              kind: 'text',
              senderType: 'user',
              text: announcement.body_text,
            }
      );
      if (result.success) counts[delivery]++;
      else counts.failed++;
    }
    counts.failed += contactIds.length - contacts.length;

    const { data: updated } = await ctx.supabase
      .from('voice_announcements')
      .update({
        sent_counts: accumulateSendCounts(announcement.sent_counts, counts),
        last_sent_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('sent_counts')
      .single();

    return NextResponse.json({
      data: { run: counts, totals: updated?.sent_counts ?? null },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
