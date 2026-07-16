"use client";

// ============================================================
// Owners Den — client-side session context.
//
// Wraps every portal page (src/app/(den)/den/(portal)/layout.tsx).
// On mount it:
//   1. checks the Supabase session (none → /den/login)
//   2. POSTs /api/den/auth/complete — idempotent; re-links contacts
//      on every visit and enforces the verified-phone gate
//      (phone_unverified → /den/verify-phone)
//   3. loads /api/den/me into context for the shell + pages
// ============================================================

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export interface DenLink {
  account_id: string;
  contact_id: string;
  agency_name: string | null;
}

export interface DenMe {
  den_user_id: string;
  phone: string;
  display_name: string | null;
  notify_matches: boolean;
  notify_bids: boolean;
  digest_frequency: "off" | "daily" | "weekly";
  links: DenLink[];
  property_count: number;
}

interface DenContextValue {
  me: DenMe | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const DenContext = createContext<DenContextValue>({
  me: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function useDen() {
  return useContext(DenContext);
}

export function DenProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<DenMe | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (): Promise<DenMe | null> => {
    const res = await fetch("/api/den/me");
    if (!res.ok) return null;
    return (await res.json()) as DenMe;
  }, []);

  const refresh = useCallback(async () => {
    const fresh = await loadMe();
    if (fresh) setMe(fresh);
  }, [loadMe]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/den/login";
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
        router.replace("/den/login");
        return;
      }

      const completeRes = await fetch("/api/den/auth/complete", { method: "POST" });
      if (cancelled) return;
      if (completeRes.status === 401) {
        router.replace("/den/login");
        return;
      }
      if (completeRes.status === 403) {
        const body = await completeRes.json().catch(() => null);
        if (body?.code === "phone_unverified") {
          router.replace("/den/verify-phone");
          return;
        }
      }

      const fresh = await loadMe();
      if (cancelled) return;
      if (!fresh) {
        router.replace("/den/login");
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
    <DenContext.Provider value={{ me, loading, refresh, signOut }}>
      {children}
    </DenContext.Provider>
  );
}
