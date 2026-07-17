import { NextResponse } from 'next/server';

// iOS Universal Links verification — the iOS counterpart of
// assetlinks.json (mobile/app.json declares associatedDomains).
// Set APPLE_TEAM_ID once the Apple Developer account exists; until
// then we serve an empty app list. Must be served as JSON at exactly
// this path, no redirect.
export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID ?? '';
  const appId = teamId ? `${teamId}.com.convoreal.app` : null;

  return NextResponse.json(
    {
      applinks: {
        apps: [],
        details: appId ? [{ appID: appId, paths: ['*'] }] : [],
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  );
}
