'use client';

// ============================================================
// Buyer portal — client-side session context.
//
// Wraps every portal page (src/app/(buyer)/buyer/(portal)/layout.tsx).
// On mount it:
//   1. checks the Supabase session (none → /buyer/login)
//   2. POSTs /api/buyer/auth/complete — idempotent; re-links contacts
//      and re-seeds the shortlist on every visit, and enforces the
//      verified-phone gate (phone_unverified → /buyer/verify-phone)
//   3. loads /api/buyer/me into context for the shell + pages
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

export interface BuyerLink {
  account_id: string;
  contact_id: string;
  agency_name: string | null;
}

export interface BuyerMe {
  buyer_user_id: string;
  phone: string;
  display_name: string | null;
  notify_matches: boolean;
  links: BuyerLink[];
  shortlist_count: number;
}

interface BuyerContextValue {
  me: BuyerMe | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const BuyerContext = createContext<BuyerContextValue>({
  me: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function useBuyer() {
  return useContext(BuyerContext);
}

export function BuyerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<BuyerMe | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (): Promise<BuyerMe | null> => {
    const res = await fetch('/api/buyer/me');
    if (!res.ok) return null;
    return (await res.json()) as BuyerMe;
  }, []);

  const refresh = useCallback(async () => {
    const fresh = await loadMe();
    if (fresh) setMe(fresh);
  }, [loadMe]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/buyer/login';
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace('/buyer/login');
        return;
      }

      const completeRes = await fetch('/api/buyer/auth/complete', {
        method: 'POST',
      });
      if (cancelled) return;
      if (completeRes.status === 401) {
        router.replace('/buyer/login');
        return;
      }
      if (completeRes.status === 403) {
        const body = await completeRes.json().catch(() => null);
        if (body?.code === 'phone_unverified') {
          router.replace('/buyer/verify-phone');
          return;
        }
      }

      const fresh = await loadMe();
      if (cancelled) return;
      if (!fresh) {
        router.replace('/buyer/login');
        return;
      }
      setMe(fresh);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadMe]);

  return (
    <BuyerContext.Provider value={{ me, loading, refresh, signOut }}>
      {children}
    </BuyerContext.Provider>
  );
}
