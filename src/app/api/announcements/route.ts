import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { burnCredits } from '@/lib/credits/burn';
import { newBurnKey, refundBurn } from '@/lib/credits/refund-burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { isNarrationLanguage } from '@/lib/video/listing-video';

const TEXT_MAX = 1200;

const UNQUEUED_ERROR = 'Could not be queued';

async function failUnqueuedAnnouncement(
  supabase: SupabaseClient,
  accountId: string,
  announcementId: string,
  burnKey: string
): Promise<'failed' | 'taken' | 'unknown'> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from('voice_announcements')
      .update({ status: 'failed', error: UNQUEUED_ERROR })
      .eq('id', announcementId)
      .eq('account_id', accountId)
      .eq('status', 'generating')
      .select('id');
    if (!error && data?.length) return 'failed';
    if (!error) {
      const { data: row, error: readError } = await supabase
        .from('voice_announcements')
        .select('status, error')
        .eq('id', announcementId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (!readError) {
        return row?.status === 'failed' && row.error === UNQUEUED_ERROR
          ? 'failed'
          : 'taken';
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
  }
  console.error(
    `[announcements] Announcement ${announcementId} for account ${accountId} could not be marked failed after its job was not queued; its charge ${burnKey} is held until reconciled manually`
  );
  return 'unknown';
}

// GET /api/announcements — the account's audio announcements
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('voice_announcements')
      .select(
        'id, title, body_text, language, status, audio_url, error, sent_counts, last_sent_at, created_at'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/announcements — create an announcement and queue its voice
// note render on the worker
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `agent:createAnnouncement:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const title =
      typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!title || !text) {
      return NextResponse.json(
        { error: 'title and text are required' },
        { status: 400 }
      );
    }
    if (text.length > TEXT_MAX) {
      return NextResponse.json(
        { error: `text must be at most ${TEXT_MAX} characters` },
        { status: 400 }
      );
    }
    const language = isNarrationLanguage(body?.language)
      ? body.language
      : 'en-IN';

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return NextResponse.json(
        {
          error:
            'Audio announcements require the queue worker (REDIS_URL is not configured on this deployment).',
        },
        { status: 503 }
      );
    }

    // Charge BEFORE the work is queued (credits-engine rule); the
    // worker refunds on failure.
    const cost = AI_FEATURE_COSTS.audio_announcement;
    const burnKey = newBurnKey('audio_announcement');
    const burn = await burnCredits(ctx.accountId, 'audio_announcement', cost, {
      retryKey: burnKey,
    });
    if (!burn.success) {
      return NextResponse.json(
        {
          error: `Not enough credits — rendering a voice note costs ${cost} cr.`,
          deficit: burn.deficit,
        },
        { status: 402 }
      );
    }

    const { data: announcement, error: insertErr } = await ctx.supabase
      .from('voice_announcements')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        title,
        body_text: text,
        language,
        burn_key: burnKey,
      })
      .select('id, title, status, language')
      .single();
    if (insertErr || !announcement) {
      await refundBurn(ctx.accountId, 'audio_announcement', burnKey, {
        reason: 'audio_announcement insert failed',
      });
      return NextResponse.json(
        { error: insertErr?.message || 'Failed to create announcement' },
        { status: 500 }
      );
    }

    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    try {
      await redis.connect();
      await redis.rpush(
        'listing-videos',
        JSON.stringify({
          kind: 'announcement_audio',
          announcementId: announcement.id,
          accountId: ctx.accountId,
        })
      );
    } catch (err) {
      const outcome = await failUnqueuedAnnouncement(
        ctx.supabase,
        ctx.accountId,
        announcement.id,
        burnKey
      );
      if (outcome === 'failed') {
        await refundBurn(ctx.accountId, 'audio_announcement', burnKey, {
          reason: 'audio_announcement could not be queued',
        });
      }
      throw err;
    } finally {
      redis.disconnect();
    }

    return NextResponse.json({ data: announcement });
  } catch (err) {
    return toErrorResponse(err);
  }
}
