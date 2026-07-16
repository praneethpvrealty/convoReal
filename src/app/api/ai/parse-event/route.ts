import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { parseEventFromInput, resolveByName, istLocalToUtcIso } from '@/lib/calendar/event-parse';
import { autoLinkContactProperty } from '@/lib/calendar/auto-link';

// POST /api/ai/parse-event
// Turns a natural-language scheduling request (typed text or a
// recorded voice note) into a structured event/task draft with
// contact / property / team-member references resolved against the
// caller's account. Credit-metered: burned before the Gemini call,
// refunded if it fails. The client shows the resolved draft for a
// one-tap confirm — this endpoint never writes the event itself.

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI is not configured on this server.' }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as {
      text?: string;
      audio?: { base64?: string; mimeType?: string };
    } | null;

    const text = body?.text?.trim();
    const audioBase64 = body?.audio?.base64;
    const audioMime = body?.audio?.mimeType;

    if (!text && !audioBase64) {
      return NextResponse.json({ error: 'Provide text or audio to parse.' }, { status: 400 });
    }
    if (audioBase64 && audioBase64.length * 0.75 > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'Voice note is too large (max 8MB).' }, { status: 413 });
    }

    const feature = audioBase64 ? 'voice_event_parse' : 'event_parse';
    const cost = AI_FEATURE_COSTS[feature];
    const burn = await burnCredits(ctx.accountId, feature, cost, { client: ctx.supabase });
    if (!burn.success) {
      return NextResponse.json(
        { error: 'Insufficient credits to parse this event.', creditsNeeded: cost, upgradeRequired: true },
        { status: 402 },
      );
    }

    const { data: members } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name')
      .eq('account_id', ctx.accountId);

    let draft;
    try {
      draft = await parseEventFromInput({
        text: text || undefined,
        audio: audioBase64 ? { base64: audioBase64, mimeType: audioMime || 'audio/webm' } : undefined,
        memberNames: (members || []).map((m) => m.full_name).filter(Boolean) as string[],
      });
    } catch (apiErr) {
      await refundCredits(ctx.accountId, feature, cost, { client: ctx.supabase });
      console.error('[parse-event] Gemini call failed:', apiErr);
      return NextResponse.json({ error: 'Could not understand that. Please try again.' }, { status: 502 });
    }

    if (draft.intent === 'none') {
      return NextResponse.json({ data: { draft, resolved: null } });
    }

    const [{ data: contacts }, { data: properties }] = await Promise.all([
      ctx.supabase
        .from('contacts')
        .select('id, name, phone, last_inquired_property_id')
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('properties')
        .select('id, title, property_code, location, sublocality')
        .eq('account_id', ctx.accountId),
    ]);

    const { contact, property } = autoLinkContactProperty(
      resolveByName(draft.contact_name, contacts || [], (c) => c.name || ''),
      resolveByName(
        draft.property_hint,
        properties || [],
        (p) => `${p.property_code || ''} ${p.title || ''} ${p.location || ''} ${p.sublocality || ''}`,
      ),
      contacts || [],
      properties || [],
    );
    const assignee = resolveByName(
      draft.assignee_name,
      (members || []).map((m) => ({ id: m.user_id as string, full_name: m.full_name as string | null })),
      (m) => m.full_name || '',
    );

    const startIso = istLocalToUtcIso(draft.start_time);
    let endIso = istLocalToUtcIso(draft.end_time);
    if (startIso && !endIso) {
      const mins = draft.duration_minutes || 60;
      endIso = new Date(new Date(startIso).getTime() + mins * 60 * 1000).toISOString();
    }

    return NextResponse.json({
      data: {
        draft,
        resolved: {
          start_time: startIso,
          end_time: endIso,
          contact: contact ? { id: contact.id, name: contact.name, phone: contact.phone } : null,
          property: property ? { id: property.id, title: property.title } : null,
          assignee: assignee ? { user_id: assignee.id, full_name: assignee.full_name } : null,
        },
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
