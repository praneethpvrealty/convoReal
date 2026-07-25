import { headers } from 'next/headers';
import { BRANDING } from '@/config/branding';

export function fallbackSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(
    /\/$/,
    ''
  );
}

// Canonical URLs must stay on the host the visitor is on — a tenant
// subdomain showcase that canonicalizes to the main marketing domain
// tells crawlers to credit (and index) the wrong site.
export async function resolveRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host');
  if (!host) return fallbackSiteUrl();
  const proto = h.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}
