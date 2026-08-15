import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { analyzeCall } from '@/lib/ai/call-analysis';
import { uploadCallRecording } from '@/lib/storage/upload';
import type { CallDirection } from '@/types';

// POST /api/contacts/[id]/calls/analyze
// Turns an uploaded call recording (base64 audio) or a pasted
// transcript into a logged call with an AI summary, key points,
// action items, and a client-ready WhatsApp update draft. The
// draft is never sent from here — the agent reviews it first and
// sends via the send-update route. Credit-metered like
// /api/ai/parse-event: burned before the Gemini call, refunded if
// it fails.

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI is not configured on this server.' }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as {
      audio?: { base64?: string; mimeType?: string };
      transcript?: string;
      context?: string;
      direction?: string;
      called_at?: string;
      duration_seconds?: number | null;
    } | null;

    const transcriptText = body?.transcript?.trim();
    const audioBase64 = body?.audio?.base64;
    const audioMime = body?.audio?.mimeType;
    const context = body?.context?.trim();

    if (!transcriptText && !audioBase64) {
      return NextResponse.json(
        { error: 'Provide a call recording or a transcript to analyze.' },
        { status: 400 },
      );
    }
    if (audioBase64 && audioBase64.length * 0.75 > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'Recording is too large (max 15MB).' }, { status: 413 });
    }

    const direction: CallDirection = body?.direction === 'inbound' ? 'inbound' : 'outbound';

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, name')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const feature = audioBase64 ? 'call_recording_analysis' : 'call_analysis';
    const cost = AI_FEATURE_COSTS[feature];
    const burn = await burnCredits(ctx.accountId, feature, cost);
    if (!burn.success) {
      return NextResponse.json(
        { error: 'Insufficient credits to analyze this call.', creditsNeeded: cost, upgradeRequired: true },
        { status: 402 },
      );
    }

    let analysis;
    try {
      analysis = await analyzeCall({
        transcriptText: transcriptText || undefined,
        audio: audioBase64
          ? { base64: audioBase64, mimeType: audioMime || 'audio/mpeg' }
          : undefined,
        // Outbound greetings use `name` alone, never the Engine-display
        // full name (migration 166).
        contactName: contact.name,
        context: context || undefined,
      });
    } catch (apiErr) {
      await refundCredits(ctx.accountId, feature, cost);
      console.error('[calls/analyze] Gemini call failed:', apiErr);
      return NextResponse.json(
        { error: 'Could not analyze that call. Please try again.' },
        { status: 502 },
      );
    }

    let recordingUrl: string | null = null;
    if (audioBase64) {
      try {
        recordingUrl = await uploadCallRecording(
          ctx.accountId,
          Buffer.from(audioBase64, 'base64'),
          audioMime || 'audio/mpeg',
        );
      } catch (uploadErr) {
        // The analysis is already paid for and useful — keep it and log
        // the call without the stored recording rather than failing.
        console.error('[calls/analyze] recording upload failed:', uploadErr);
      }
    }

    const { data: call, error } = await ctx.supabase
      .from('contact_call_logs')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        user_id: ctx.userId,
        called_at: body?.called_at ?? new Date().toISOString(),
        direction,
        duration_seconds: body?.duration_seconds ?? null,
        outcome: 'connected',
        notes: context || null,
        recording_url: recordingUrl,
        transcript: analysis.transcript ?? transcriptText ?? null,
        summary: analysis.summary,
        key_points: analysis.key_points.length > 0 ? analysis.key_points : null,
        action_items: analysis.action_items.length > 0 ? analysis.action_items : null,
        update_draft: analysis.update_draft,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ call }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
