"use client";

// TEMPORARY repro page for the wedged auth-lock bug. Mounts AuthProvider
// (which calls getSession on mount) so the resilient lock fallback can be
// observed while another tab holds the auth Web Lock. DELETE BEFORE COMMIT.

import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

declare global {
  interface Window {
    __probe?: {
      warns: string[];
      loadingResolvedMs?: number;
      t0: number;
      directGetSessionMs?: number | "pending";
    };
  }
}

if (typeof window !== "undefined" && !window.__probe) {
  window.__probe = { warns: [], t0: performance.now() };
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    window.__probe!.warns.push(
      `${Math.round(performance.now() - window.__probe!.t0)}ms: ${args.map(String).join(" ")}`,
    );
    origWarn(...args);
  };
}

function Probe() {
  const { loading, user } = useAuth();
  useEffect(() => {
    if (!loading && window.__probe && window.__probe.loadingResolvedMs === undefined) {
      window.__probe.loadingResolvedMs = Math.round(performance.now() - window.__probe.t0);
    }
  }, [loading]);
  useEffect(() => {
    if (!window.__probe || window.__probe.directGetSessionMs !== undefined) return;
    window.__probe.directGetSessionMs = "pending";
    const t = performance.now();
    void createClient()
      .auth.getSession()
      .then(() => {
        window.__probe!.directGetSessionMs = Math.round(performance.now() - t);
      });
  }, []);
  return (
    <div className="p-8 text-white bg-slate-950 min-h-screen font-mono text-sm">
      <p data-probe="loading">loading: {String(loading)}</p>
      <p data-probe="user">user: {user ? user.id : "null"}</p>
      <p className="mt-4 text-slate-400">
        Wedge the lock from another tab, then reload this page. With the
        fix, loading resolves ~5s after mount with a console warning.
      </p>
    </div>
  );
}

export default function DevLockReproPage() {
  return (
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}
