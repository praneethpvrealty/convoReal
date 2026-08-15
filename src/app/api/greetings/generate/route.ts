import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { generateText } from '@/lib/ai/gemini';
import {
  generateAiImage,
  IMAGE_PROVIDER_UNAVAILABLE,
} from '@/lib/ai/image-gen';
import {
  GREETING_SYSTEM_PROMPT,
  buildGreetingPrompt,
  greetingImagePrompt,
  normalizeGreetingText,
  type GreetingTone,
} from '@/lib/greetings/generate';
import { uploadGreetingImage } from '@/lib/storage/upload';
import { storagePublicUrl } from '@/lib/storage/url';

const AI_FEATURE = 'greetings_generate' as const;

// POST /api/greetings/generate — AI-compose an agency greeting for an
// occasion, optionally with a festive card image stored in the public
// greetings bucket (Meta fetches the header image from there at send
// time, so a data URI would not do).
export async function POST(request: NextRequest) {
  let ctx;
  const cost = AI_FEATURE_COSTS[AI_FEATURE];

  try {
    ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `greetings:generate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const gate = await checkPlanLimit(ctx, 'ai');
    if (!gate.allowed) return gateResponse(gate);

    const body = await request.json().catch(() => null);
    const occasionLabel = String(body?.occasion ?? '').trim();
    if (!occasionLabel) {
      return NextResponse.json(
        { error: 'occasion is required' },
        { status: 400 }
      );
    }
    const tone = body?.tone as GreetingTone | undefined;
    const notes = typeof body?.notes === 'string' ? body.notes : undefined;
    const generateImage = body?.generateImage !== false;

    if (
      generateImage &&
      !process.env.HF_ACCESS_TOKEN &&
      !process.env.GEMINI_API_KEY
    ) {
      return NextResponse.json(
        { error: IMAGE_PROVIDER_UNAVAILABLE },
        { status: 400 }
      );
    }

    const burn = await burnCredits(ctx.accountId, AI_FEATURE, cost, {
      client: ctx.supabase,
    });
    if (!burn.success) {
      return NextResponse.json(
        {
          error: 'Insufficient credits for AI greetings generation.',
          creditsNeeded: cost,
          upgradeRequired: true,
        },
        { status: 402 }
      );
    }

    try {
      const raw = await generateText(
        buildGreetingPrompt({
          occasionLabel,
          agencyName: ctx.account.name,
          tone,
          notes,
        }),
        GREETING_SYSTEM_PROMPT,
        { feature: AI_FEATURE }
      );
      const text = normalizeGreetingText(raw);

      // Card image failure never fails the request — the text still ships.
      let imagePath: string | null = null;
      if (generateImage) {
        try {
          const dataUri = await generateAiImage({
            prompt: greetingImagePrompt(occasionLabel),
            provider: 'huggingface',
          });
          const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
          if (match) {
            imagePath = await uploadGreetingImage(
              ctx.accountId,
              Buffer.from(match[2], 'base64'),
              match[1]
            );
          }
        } catch (imgErr) {
          console.error(
            '[Greetings] card image generation failed, returning text only:',
            (imgErr as Error).message
          );
        }
      }

      return NextResponse.json({
        data: {
          text,
          imagePath,
          imageUrl: imagePath ? storagePublicUrl(imagePath) : null,
        },
      });
    } catch (generationErr) {
      await refundCredits(ctx.accountId, AI_FEATURE, cost, {
        client: ctx.supabase,
      });
      throw generationErr;
    }
  } catch (err) {
    console.error('[POST /api/greetings/generate] error:', err);
    return toErrorResponse(err);
  }
}
