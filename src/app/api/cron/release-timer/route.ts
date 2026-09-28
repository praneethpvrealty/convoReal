import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Starts the release-timer GitHub workflow. GitHub runs this repository's
 * scheduled workflows hours late, so Vercel Cron is the clock and the
 * workflow keeps the release logic. Registered in vercel.json (every 15
 * minutes). Auth: the same constant-time shared-secret check as the other
 * crons. Needs RELEASE_TIMER_GITHUB_TOKEN, a fine-grained token with
 * Actions read and write on this repository only, plus Vercel's
 * VERCEL_GIT_REPO_OWNER and VERCEL_GIT_REPO_SLUG system variables. Fails
 * closed (503) when any of them is missing.
 */
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

  const token = process.env.RELEASE_TIMER_GITHUB_TOKEN;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const repo = process.env.VERCEL_GIT_REPO_SLUG;
  if (!token || !owner || !repo) {
    return NextResponse.json(
      { error: 'release timer not configured' },
      { status: 503 }
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/release-timer.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    console.error('[release-timer] dispatch failed:', res.status, detail);
    return NextResponse.json(
      { error: `dispatch failed with ${res.status}` },
      { status: 502 }
    );
  }
  return NextResponse.json({ data: { dispatched: true } });
}
