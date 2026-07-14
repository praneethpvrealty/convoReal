"use client";

// TEMPORARY repro page for the wedged auth-lock bug. Mounts AuthProvider
// (which calls getSession on mount) so the resilient lock fallback can be
// observed while another tab holds the auth Web Lock. DELETE BEFORE COMMIT.

import { AuthProvider, useAuth } from "@/hooks/use-auth";

function Probe() {
  const { loading, user } = useAuth();
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
