import { headers } from 'next/headers';
import {
  cachedFetchFallbackAccount,
  cachedFetchShowcaseData,
  cachedResolveAccountFromSubdomain,
  cachedResolveShowcaseRef,
  resolveSubdomainFromHost,
} from '@/lib/showcase/public-data';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadAuthorityContext(
  searchParams: Promise<{ account_id?: string; ref?: string }>
) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const subdomain = resolveSubdomainFromHost(requestHeaders.get('host') || '');
  const ref = params.account_id || params.ref;
  let accountId: string | null = null;

  if (subdomain) {
    accountId = await cachedResolveAccountFromSubdomain(subdomain);
    if (!accountId) return null;
  } else if (ref) {
    if (!UUID_RE.test(ref)) return null;
    accountId = (await cachedResolveShowcaseRef(ref))?.accountId ?? null;
    if (!accountId) return null;
  } else {
    accountId =
      process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID ||
      (await cachedFetchFallbackAccount());
  }

  if (!accountId) return null;
  return { accountId, ...(await cachedFetchShowcaseData(accountId, false)) };
}
