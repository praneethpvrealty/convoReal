import { NextResponse } from 'next/server';

// Android App Links verification — lets https://convoreal.com/... URLs
// open the mobile app (mobile/app.json declares the matching
// intentFilters with autoVerify). Android only trusts the claim when
// this file lists the app's release signing-key fingerprint.
//
// Set ANDROID_APP_CERT_SHA256 to the colon-separated SHA-256 of the
// signing cert (from `eas credentials` after the first Android build;
// multiple certs comma-separated). Until it's set we serve an empty
// list — valid, just grants nothing.
export async function GET() {
  const fingerprints = (process.env.ANDROID_APP_CERT_SHA256 ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const statements = fingerprints.length
    ? [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'com.convoreal.app',
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ]
    : [];

  return NextResponse.json(statements, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
