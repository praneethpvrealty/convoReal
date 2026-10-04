import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { retryQueuedRefunds } from '@/lib/credits/refund-burn';

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
    const result = await retryQueuedRefunds();
    console.log('[credit-refunds]', JSON.stringify(result));
    return NextResponse.json({ data: result });
  } catch (err) {
    const error = err as Error;
    console.error('[credit-refunds] failed:', error);
    return NextResponse.json(
      { error: error.message || 'Refund retry failed' },
      { status: 500 }
    );
  }
}
