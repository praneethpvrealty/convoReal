'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShareGrantTtlKey } from '@/lib/inventory/share-grants';

export interface ShareGrantKey {
  id: string;
  token: string;
}

interface UseShareLinkGrantOptions {
  open: boolean;
  propertyId: string | null;
  revealLocation: boolean;
  revealDocuments: boolean;
  revealPrivateImages: boolean;
  ttl: ShareGrantTtlKey;
  onGrantsChanged: () => void;
}

interface HeldGrant extends ShareGrantKey {
  propertyId: string;
}

async function revokeShareGrant(propertyId: string, grantId: string) {
  try {
    await fetch(
      `/api/properties/${propertyId}/share-grants?grant_id=${grantId}`,
      { method: 'DELETE' }
    );
  } catch (err) {
    console.error('[property-share] Grant revoke failed:', err);
  }
}

export function useShareLinkGrant({
  open,
  propertyId,
  revealLocation,
  revealDocuments,
  revealPrivateImages,
  ttl,
  onGrantsChanged,
}: UseShareLinkGrantOptions) {
  const [linkGrant, setLinkGrant] = useState<ShareGrantKey | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  const linkGrantRef = useRef<HeldGrant | null>(null);
  const pendingRef = useRef<Promise<ShareGrantKey | null> | null>(null);
  const contactGrantsRef = useRef<Record<string, string>>({});
  const generationRef = useRef(0);
  const onGrantsChangedRef = useRef(onGrantsChanged);
  const unmasked = revealLocation || revealDocuments || revealPrivateImages;

  useEffect(() => {
    onGrantsChangedRef.current = onGrantsChanged;
  }, [onGrantsChanged]);

  useEffect(() => {
    generationRef.current += 1;
    pendingRef.current = null;
    contactGrantsRef.current = {};
    const previous = linkGrantRef.current;
    linkGrantRef.current = null;
    Promise.resolve().then(() => {
      setLinkGrant(null);
      setGrantBusy(false);
    });
    if (previous && open) {
      void revokeShareGrant(previous.propertyId, previous.id).then(() =>
        onGrantsChangedRef.current()
      );
    }
  }, [
    open,
    propertyId,
    revealLocation,
    revealDocuments,
    revealPrivateImages,
    ttl,
  ]);

  const mintGrant = useCallback(
    async (contactId: string | null): Promise<ShareGrantKey> => {
      const res = await fetch(`/api/properties/${propertyId}/share-grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          reveal_location: revealLocation,
          reveal_documents: revealDocuments,
          reveal_private_images: revealPrivateImages,
          expires_in: ttl,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to unmask this share');
      return json.data as ShareGrantKey;
    },
    [propertyId, revealLocation, revealDocuments, revealPrivateImages, ttl]
  );

  const ensureLinkGrant = useCallback(async (): Promise<string | null> => {
    if (!unmasked || !propertyId) return null;
    if (linkGrantRef.current) return linkGrantRef.current.token;
    if (!pendingRef.current) {
      const generation = generationRef.current;
      setGrantBusy(true);
      pendingRef.current = mintGrant(null)
        .then((grant) => {
          if (generation !== generationRef.current) {
            void revokeShareGrant(propertyId, grant.id);
            return null;
          }
          linkGrantRef.current = { ...grant, propertyId };
          setLinkGrant(grant);
          onGrantsChangedRef.current();
          return grant;
        })
        .finally(() => {
          if (generation !== generationRef.current) return;
          pendingRef.current = null;
          setGrantBusy(false);
        });
    }
    const grant = await pendingRef.current;
    return grant?.token ?? null;
  }, [unmasked, propertyId, mintGrant]);

  const ensureContactGrant = useCallback(
    async (contactId: string): Promise<string | null> => {
      if (!unmasked || !propertyId) return null;
      const existing = contactGrantsRef.current[contactId];
      if (existing) return existing;
      const generation = generationRef.current;
      try {
        const grant = await mintGrant(contactId);
        if (generation === generationRef.current) {
          contactGrantsRef.current = {
            ...contactGrantsRef.current,
            [contactId]: grant.token,
          };
        }
        onGrantsChangedRef.current();
        return grant.token;
      } catch (err) {
        console.error('[property-share] Contact grant mint failed:', err);
        return ensureLinkGrant();
      }
    },
    [unmasked, propertyId, mintGrant, ensureLinkGrant]
  );

  const forgetGrant = useCallback((grant: ShareGrantKey): boolean => {
    contactGrantsRef.current = Object.fromEntries(
      Object.entries(contactGrantsRef.current).filter(
        ([, token]) => token !== grant.token
      )
    );
    if (linkGrantRef.current?.id !== grant.id) return false;
    linkGrantRef.current = null;
    setLinkGrant(null);
    return true;
  }, []);

  return {
    linkGrant,
    grantBusy,
    unmasked,
    ensureLinkGrant,
    ensureContactGrant,
    forgetGrant,
  };
}
