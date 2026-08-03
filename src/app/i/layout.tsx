// ============================================================
// /i/[token] layout — beta invite shell.
//
// Sits outside both `(auth)` and `(dashboard)` for the same reason
// /join does: the page must render for anonymous visitors, and an
// already-signed-in user who opens a forwarded link should see the
// invite rather than be bounced to a dashboard.
//
// Referrer-Policy: no-referrer
//   The plaintext invite token is in the URL path. Without this,
//   any externally-loaded resource would receive the full invite
//   URL in its `Referer` header. The page loads nothing external
//   today; this is the guard against a future regression leaking a
//   live seat to a CDN's logs.
//
// robots: noindex
//   These links get forwarded through WhatsApp constantly. A
//   crawled invite URL in search results is a seat anyone can take.
//
// The page owns its own full-bleed background, so this layout adds
// metadata and nothing else.
// ============================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function BetaInviteLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
