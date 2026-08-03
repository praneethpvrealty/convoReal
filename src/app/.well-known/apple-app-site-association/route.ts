import { NextResponse } from 'next/server';

// iOS Universal Links verification — the iOS counterpart of
// assetlinks.json (mobile/app.json declares associatedDomains).
// Set APPLE_TEAM_ID once the Apple Developer account exists; until
// then we serve an empty app list. Must be served as JSON at exactly
// this path, no redirect.
//
// Only Engine-staff paths are claimed (mirroring the Android intent
// filter's pathPrefix list). Public showcase URLs — `/`,
// `/?property_id=`, `/property/*`, `/projects/*`, `/farmland/*`,
// `/list` — must never open the app: the app shell is auth-gated, so
// a buyer with the app installed would land on a login screen instead
// of the listing. OS link matching cannot see query strings, so the
// split has to be by path, which is why `/` stays unclaimed and
// app-bound links use the convoreal:// scheme instead.
const CLAIMED_PATH_PREFIXES = [
  '/inventory',
  '/pipelines',
  '/contacts',
  '/calendar',
  '/journey',
  '/broadcasts',
  '/settings',
  '/dashboard',
];

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID ?? '';
  const appId = teamId ? `${teamId}.com.convoreal.app` : null;

  return NextResponse.json(
    {
      applinks: {
        apps: [],
        details: appId
          ? [
              {
                appID: appId,
                components: CLAIMED_PATH_PREFIXES.flatMap((prefix) => [
                  { '/': prefix },
                  { '/': `${prefix}/*` },
                ]),
              },
            ]
          : [],
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  );
}
