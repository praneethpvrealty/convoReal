import { BRANDING } from '@/config/branding';

/**
 * The origin the authenticated app lives on. Supabase auth cookies are
 * host-only, so a signed-in agent browsing a tenant showcase
 * (`<label>.<baseDomain>`) carries no session on that host. The showcase
 * therefore sends its "is this visitor one of our members?" probe and
 * the import itself to this origin with credentials, and the route
 * answers only an origin `isAppSiteOrigin` accepts.
 */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(
    /\/+$/,
    ''
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True for the app origin itself and for one label under the base
 * domain over https — every host that serves this application's own
 * showcase code, and nothing else.
 */
export function isAppSiteOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  if (origin === appOrigin()) return true;
  const pattern = new RegExp(
    `^https://([a-z0-9-]+\\.)?${escapeRegExp(BRANDING.baseDomain.toLowerCase())}$`
  );
  return pattern.test(origin.toLowerCase());
}
