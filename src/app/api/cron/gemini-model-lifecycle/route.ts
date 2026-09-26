import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkModelLifecycle } from '@/lib/ai/model-lifecycle-check';

export const maxDuration = 60;

export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json({ data: await checkModelLifecycle() });
  } catch (err) {
    console.error('[gemini-model-lifecycle] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Check failed' },
      { status: 500 }
    );
  }
}
