import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';
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
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { isNarrationLanguage } from '@/lib/video/listing-video';

const TEXT_MAX = 1200;

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
    const burn = await burnCredits(ctx.accountId, 'audio_announcement', cost, {
      client: ctx.supabase,
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
      })
      .select('id, title, status, language')
      .single();
    if (insertErr || !announcement) {
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
    } finally {
      redis.disconnect();
    }

    return NextResponse.json({ data: announcement });
  } catch (err) {
    return toErrorResponse(err);
  }
}
