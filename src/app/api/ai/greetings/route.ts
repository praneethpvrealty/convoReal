import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { generateText } from '@/lib/ai/gemini';

// POST /api/ai/greetings
// Generates a personalized text greeting and a festive graphic card image
export async function POST(request: Request) {
  let ctx;
  const cost = AI_FEATURE_COSTS.greetings_generate;

  try {
    ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:greetings:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Plan gate: AI features require solo_pro or higher
    const gate = await checkPlanLimit(ctx, 'ai');
    if (!gate.allowed) return gateResponse(gate);

    const body = await request.json().catch(() => null);
    if (!body || !body.occasion || !body.contactName) {
      return NextResponse.json(
        { error: 'occasion and contactName are required' },
        { status: 400 },
      );
    }

    const { occasion, contactName, generateImage = false } = body;

    // Validate Hugging Face config if image is requested
    if (generateImage && !process.env.HF_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: 'HF_ACCESS_TOKEN is not configured on the server. Image generation is disabled.' },
        { status: 400 },
      );
    }

    // Burn credits
    const burn = await burnCredits(ctx.accountId, 'greetings_generate', cost, { client: ctx.supabase });
    if (!burn.success) {
      return NextResponse.json(
        {
          error: 'Insufficient credits for AI greetings generation.',
          creditsNeeded: cost,
          upgradeRequired: true,
        },
        { status: 402 },
      );
    }

    let textResult = '';
    let imageResult = '';

    try {
      // 1. Generate text greeting via Gemini
      const systemInstruction = 
        'You are an elite, personal real estate relationship manager. Write a warm, customized personal greeting message for WhatsApp.';
      const prompt = `Write a short, engaging, and personal greeting for my client named "${contactName}" for the occasion: "${occasion}". Make it professional yet warm, and keep it under 3-4 sentences so it fits perfectly in a WhatsApp message. Do not include placeholders like [Your Name], just write the greeting itself.`;
      
      textResult = await generateText(prompt, systemInstruction);

      // 2. Generate graphic card image via Hugging Face if requested
      if (generateImage) {
        const imagePrompt = getImagePromptForOccasion(occasion);
        const hfToken = process.env.HF_ACCESS_TOKEN;
        const url = 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';

        console.log(`[Greetings AI] Generating image using HuggingFace with prompt: "${imagePrompt}"`);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: imagePrompt }),
        });

        if (!response.ok) {
          console.error(`[Greetings AI] Image generation failed: ${response.statusText}`);
          // We don't crash the entire request if image generation fails, just return the text greeting
        } else {
          const buffer = await response.arrayBuffer();
          imageResult = `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`;
        }
      }

      return NextResponse.json({
        text: textResult.trim(),
        imageUrl: imageResult || undefined,
      });

    } catch (generationErr) {
      // Refund credits on failure
      await refundCredits(ctx.accountId, 'greetings_generate', cost, { client: ctx.supabase });
      throw generationErr;
    }

  } catch (err) {
    console.error('[POST /api/ai/greetings] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate greeting' },
      { status: 500 },
    );
  }
}

function getImagePromptForOccasion(occasion: string): string {
  const cleanOccasion = occasion.toLowerCase().trim();
  if (cleanOccasion.includes('ganesh')) {
    return 'A premium artistic greeting card for Ganesh Chaturthi, featuring Lord Ganesha, festive lights, diyas, vibrant colors, gold accents, elegant layout, high resolution, professional digital art, 4k';
  }
  if (cleanOccasion.includes('new year')) {
    return 'A premium elegant greeting card for New Year, with glowing gold sparkles, abstract fireworks, dark luxury background, gold ribbon, festive, high resolution, professional design, 4k';
  }
  if (cleanOccasion.includes('xmas') || cleanOccasion.includes('christmas')) {
    return 'A premium beautiful greeting card for Christmas, featuring a decorated christmas tree, glowing lights, soft snow, warm festive atmosphere, elegant layout, high resolution, professional design, 4k';
  }
  if (cleanOccasion.includes('birthday') || cleanOccasion.includes('birth day')) {
    return 'A premium elegant birthday greeting card, with warm golden balloons, minimalist design, elegant confetti, high resolution, professional layout, 4k';
  }
  return `A premium artistic festive greeting card for ${occasion}, elegant layout, warm glowing lighting, vibrant colors, high resolution, professional graphic design, 4k`;
}
