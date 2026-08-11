import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

// POST /api/client-error
//
// Somewhere to send a crash that happens in the browser. The error
// boundary used to console.error and stop there, which means a listing
// that renders fine for us and breaks for one visitor leaves nothing
// behind — no stack, no route, no build. That happened: a co-broker hit
// "Our Agent Is Running Late" on a showcase link that served a correct
// 200, with every JS chunk present, and there was no way to find out
// why.
//
// Deliberately small: this logs and returns. `console.error` on a
// Vercel function is what makes the report show up in runtime logs
// (and in get_runtime_errors), so no client SDK or vendor is involved.
const REPORT_LIMIT = { limit: 10, windowMs: 60_000 };
const MAX_FIELD = 600;

const clip = (v: unknown): string =>
  typeof v === 'string' ? v.slice(0, MAX_FIELD) : '';

export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    // A crash loop must not become its own outage: over budget we drop
    // the report rather than the request, so the browser never retries.
    const limit = checkRateLimit(`clientError:${ip}`, REPORT_LIMIT);
    if (!limit.success) return NextResponse.json({ ok: true });

    const body = (await request.json().catch(() => null)) as {
      message?: unknown;
      digest?: unknown;
      stack?: unknown;
      url?: unknown;
      buildId?: unknown;
    } | null;
    if (!body) return NextResponse.json({ ok: true });

    console.error('[client-error]', {
      message: clip(body.message) || '(no message)',
      digest: clip(body.digest),
      url: clip(body.url),
      buildId: clip(body.buildId),
      ua: (request.headers.get('user-agent') || '').slice(0, 200),
      stack: clip(body.stack),
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never surface a reporting failure to a page that is already broken.
    return NextResponse.json({ ok: true });
  }
}
