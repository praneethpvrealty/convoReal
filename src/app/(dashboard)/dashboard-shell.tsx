"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading } = useAuth();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    console.log('[SHELL GATE] evaluating profile:', {
      loading,
      profileLoading,
      user: !!user,
      profile: profile ? { full_name: profile.full_name, email: profile.email } : null,
    });

    if (!loading && !user) {
      window.location.href = "/login";
    } else if (!loading && !profileLoading && user) {
      if (!profile) {
        console.warn('[SHELL GATE] profile not found, redirecting to setup...');
        window.location.href = "/profile-setup";
      } else {
        const hasMissingName = !profile.full_name || profile.full_name.trim() === "";
        const hasMissingEmail = !profile.email || profile.email.trim() === "";
        if (hasMissingName || hasMissingEmail) {
          console.warn('[SHELL GATE] profile incomplete, redirecting to setup...', {
            hasMissingName,
            hasMissingEmail,
          });
          window.location.href = "/profile-setup";
        }
      }
    }
  }, [user, loading, profile, profileLoading]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#070b15] relative">
      {/* Premium ambient background glows */}
      <div className="absolute -top-60 -left-60 w-[600px] h-[600px] bg-primary/18 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-1/3 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden relative z-10">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
