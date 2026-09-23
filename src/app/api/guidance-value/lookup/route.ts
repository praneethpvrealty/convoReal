import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  SCHEDULE_MAX_BYTES,
  extractSchedule,
  isScheduleMimeType,
  sanitiseSchedule,
} from '@/lib/guidance-value/schedule';
import { parseValuationOptions } from '@/lib/guidance-value/schedule-fields';
import {
  lookupGuidanceValue,
  resolveGuidanceCaller,
  type GuidanceCaller,
} from '@/lib/guidance-value/server';
import type { PropertySchedule } from '@/lib/guidance-value/types';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 60;

const FEATURE = 'guidance_value_lookup';
const COST = AI_FEATURE_COSTS[FEATURE];

function parseJsonField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function readSchedule(
  caller: GuidanceCaller,
  file: File
): Promise<NextResponse | PropertySchedule> {
  if (!isScheduleMimeType(file.type)) {
    return NextResponse.json(
      {
        error: 'Upload the schedule as a PDF or a JPEG, PNG or WebP photo.',
        code: 'UNSUPPORTED_TYPE',
      },
      { status: 415 }
    );
  }
  if (file.size > SCHEDULE_MAX_BYTES) {
    return NextResponse.json(
      {
        error: 'That file is over 4 MB. Upload just the schedule page.',
        code: 'FILE_TOO_LARGE',
      },
      { status: 413 }
    );
  }

  const burst = await checkRateLimit(
    `guidanceRead:${caller.userId}`,
    RATE_LIMITS.guidanceValueRead
  );
  if (!burst.success) return rateLimitResponse(burst);

  if (caller.kind === 'portal') {
    const daily = await checkRateLimit(
      `guidanceReadDaily:${caller.userId}`,
      RATE_LIMITS.guidanceValuePortalDaily
    );
    if (!daily.success) return rateLimitResponse(daily);
  } else {
    const burn = await burnCredits(caller.ctx.accountId, FEATURE, COST);
    if (!burn.success) {
      return NextResponse.json(
        {
          error: `Not enough credits to read this schedule. ${burn.deficit} more needed.`,
          code: 'INSUFFICIENT_CREDITS',
        },
        { status: 402 }
      );
    }
  }

  try {
    return await extractSchedule({
      buffer: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
    });
  } catch (err) {
    console.error(
      '[guidance-value] schedule read failed:',
      err instanceof Error ? err.message : err
    );
    if (caller.kind === 'staff') {
      await refundCredits(caller.ctx.accountId, FEATURE, COST, {
        description: 'guidance value schedule read failed',
      });
    }
    return NextResponse.json(
      {
        error:
          caller.kind === 'staff'
            ? 'Could not read this schedule. Your credits were refunded.'
            : 'Could not read this schedule. Try a clearer photo or PDF.',
      },
      { status: 502 }
    );
  }
}

// POST /api/guidance-value/lookup
//
// multipart/form-data with `file` reads a sale deed schedule and matches
// it; JSON `{ schedule, options }` re-matches an edited schedule without
// another read.
export async function POST(request: Request) {
  try {
    const caller = await resolveGuidanceCaller();
    const contentType = request.headers.get('content-type') ?? '';

    let schedule: PropertySchedule;
    let rawOptions: unknown;
    let spent = 0;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: 'Attach the schedule file as `file`.' },
          { status: 400 }
        );
      }
      rawOptions = parseJsonField(form.get('options'));
      const read = await readSchedule(caller, file);
      if (read instanceof NextResponse) return read;
      schedule = read;
      spent = caller.kind === 'staff' ? COST : 0;
    } else {
      const limit = await checkRateLimit(
        `guidanceMatch:${caller.userId}`,
        RATE_LIMITS.guidanceValueMatch
      );
      if (!limit.success) return rateLimitResponse(limit);
      const body = await request.json().catch(() => null);
      schedule = sanitiseSchedule(body?.schedule);
      rawOptions = body?.options;
      if (!schedule.locality && !schedule.village && !schedule.city) {
        return NextResponse.json(
          { error: 'Enter the area, layout or village to search.' },
          { status: 400 }
        );
      }
    }

    const result = await lookupGuidanceValue(
      supabaseAdmin(),
      schedule,
      parseValuationOptions(rawOptions)
    );

    return NextResponse.json({ data: result, credits: { spent } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
