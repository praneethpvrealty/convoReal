import { NextResponse } from 'next/server';
import { transcribeVoiceNote } from '@/lib/ai/gemini';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { readCopilotVoiceRequest } from '@/lib/copilot/voice';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const userLimit = await checkRateLimit(
      `copilot:voice:u:${ctx.userId}`,
      RATE_LIMITS.copilotVoice
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = await checkRateLimit(
      `copilot:voice:a:${ctx.accountId}`,
      RATE_LIMITS.copilotVoiceDaily
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Voice input is not configured on this server.' },
        { status: 503 }
      );
    }

    const parsed = readCopilotVoiceRequest(
      await request.json().catch(() => null)
    );
    if ('error' in parsed) {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.status }
      );
    }

    const transcript = await transcribeVoiceNote(parsed.audio, parsed.mimeType);
    if (!transcript) {
      return NextResponse.json(
        { error: "I couldn't hear a clear instruction. Please try again." },
        { status: 422 }
      );
    }
    return NextResponse.json({
      data: { transcript: transcript.slice(0, 500) },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
