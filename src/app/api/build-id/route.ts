import { NextResponse } from 'next/server';

/**
 * Returns the current server-side Next.js build ID.
 * Used by DeploymentCheck to detect when the client is stale.
 */
export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'development' },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
