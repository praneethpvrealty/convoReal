import { apiFetch, isTimeout } from './api';

export interface PortalAdMapResult {
  propertyTitle: string;
  taggedContacts: number;
}

/**
 * Mapping an ad is a dozen sequential round trips server-side, and on
 * mobile data the request can spend most of the default 20 seconds just
 * reaching the server. The agent then read "the server did not respond"
 * for an ad that had in fact been mapped.
 */
export const PORTAL_LINK_TIMEOUT_MS = 45_000;

/**
 * Map the portal ad a lead came in on to a listing. The route is
 * idempotent for the same listing — a repeat finds its own mapping and
 * only re-tags the waiting leads — so an abandoned request is asked
 * again once, and that answer reports what actually happened.
 */
export async function mapPortalAd(
  contactId: string,
  propertyId: string
): Promise<PortalAdMapResult> {
  const post = () =>
    apiFetch<{ data: PortalAdMapResult }>(
      `/api/contacts/${contactId}/portal-link`,
      {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
        timeoutMs: PORTAL_LINK_TIMEOUT_MS,
      }
    );
  try {
    return (await post()).data;
  } catch (e) {
    if (!isTimeout(e)) throw e;
    return (await post()).data;
  }
}
