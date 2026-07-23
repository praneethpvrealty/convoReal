import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { generateAiImage, type StatusError } from '@/lib/ai/image-gen';

// POST /api/ai/enhance-image
// Calls Imagen or Hugging Face to generate/enhance listing images
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent'); // Require agent role or above

    // Plan gate: AI requires Solo Pro or higher
    const gate = await checkPlanLimit(ctx, 'ai');
    if (!gate.allowed) return gateResponse(gate);

    const accountId = ctx.accountId;
    const supabase = ctx.supabase;

    // Fetch the showcase settings to check the preferred provider
    const { data: settings } = await supabase
      .from('showcase_settings')
      .select('flyer_ai_provider, flyer_stability_model')
      .eq('account_id', accountId)
      .maybeSingle();

    const provider = settings?.flyer_ai_provider || 'huggingface';
    const stabilityModel = settings?.flyer_stability_model || undefined;

    const body = await request.json().catch(() => null);
    if (!body || !body.prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const { prompt, aspectRatio = '1:1', image } = body;

    // Validate provider keys before burning credits. The Hugging Face
    // path can fall back to Imagen, so it's usable as long as either key
    // is present.
    if (provider === 'google') {
      if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json(
          { error: 'GEMINI_API_KEY is not configured on the server.' },
          { status: 500 }
        );
      }
    } else if (provider === 'stability') {
      if (!process.env.STABILITY_API_KEY && !process.env.GEMINI_API_KEY) {
        return NextResponse.json(
          { error: 'STABILITY_API_KEY is not configured on the server.' },
          { status: 500 }
        );
      }
    } else if (!process.env.HF_ACCESS_TOKEN && !process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'No AI image provider is configured. Add HF_ACCESS_TOKEN (free, huggingface.co) or GEMINI_API_KEY on the server.' },
        { status: 400 }
      );
    }

    const cost = AI_FEATURE_COSTS.image_enhance;

    // Burn before the external call. Single flat cost regardless of
    // provider (Imagen vs HuggingFace) — no separate "full generation"
    // endpoint exists to justify pricing them differently.
    const burn = await burnCredits(accountId, 'image_enhance', cost, { client: supabase });
    if (!burn.success) {
      return NextResponse.json(
        {
          error: 'Insufficient credits for AI image enhancement.',
          creditsNeeded: cost,
          upgradeRequired: true,
        },
        { status: 402 },
      );
    }

    if (image) {
      console.log('[AI Enhance] Note: image-to-image refinement is not supported; generating from the text prompt.');
    }

    let imageResult: string;
    try {
      console.log(`[AI Enhance] Requesting generation (provider=${provider}) with prompt: "${prompt}"`);
      imageResult = await generateAiImage({ prompt, aspectRatio, provider, stabilityModel });
    } catch (apiErr: unknown) {
      // API or network failure: refund the credits
      await refundCredits(accountId, 'image_enhance', cost, { client: supabase });
      const err = apiErr as StatusError;
      console.error('[AI Enhance] API call failed, refunded credits. Error:', err.message);
      const status = err.status || 500;
      return NextResponse.json({ error: err.message || 'AI generation failed' }, { status });
    }

    return NextResponse.json({
      image: imageResult,
    });
  } catch (err: unknown) {
    console.error('[AI Enhance] Exception:', err);
    return toErrorResponse(err);
  }
}
