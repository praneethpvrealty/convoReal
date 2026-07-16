"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useOnboarding } from "@/hooks/useOnboarding";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { TopupModalProvider } from "@/components/layout/topup-modal-context";
import { CreditTopup } from "@/components/settings/CreditTopup";
import { CopilotProvider } from "@/components/copilot/copilot-context";
import { CopilotWidget } from "@/components/copilot/copilot-widget";
import { TourOverlay } from "@/components/copilot/tour-overlay";
import { BrandPulseLoader } from "@/components/ui/brand-pulse-loader";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading, isAccountArchived, signOut } = useAuth();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const { shouldShow, status, dismiss, refresh } = useOnboarding();

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
          <BrandPulseLoader size={64} label="Loading" />
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <CopilotProvider openSidebar={() => setSidebarOpen(true)}>
    <div className="flex h-screen overflow-hidden bg-[#070b15] relative">
      {/* Premium ambient background glows */}
      <div className="absolute -top-60 -left-60 w-[600px] h-[600px] bg-primary/18 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-1/3 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden relative z-10">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className={`flex-1 overflow-y-auto p-4 sm:p-6 ${isAccountArchived ? 'pointer-events-none select-none opacity-40' : ''}`}>
          {children}
        </main>
      </div>

      {/* Archived Account Overlay — rendered above everything when the
          super-admin has archived this workspace. All content is blurred
          and non-interactive; only the sign-out button is functional. */}
      {isAccountArchived && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="mx-4 max-w-md w-full rounded-2xl border border-amber-500/30 bg-slate-900/95 shadow-2xl p-8 flex flex-col items-center text-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30">
              <svg className="h-8 w-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Workspace Archived</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                This workspace has been archived by the administrator due to an inactive or expired subscription.
                All your data is safe and preserved.
              </p>
            </div>
            <div className="w-full rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-left space-y-1.5">
              <p className="text-xs font-semibold text-slate-300">To reactivate your workspace:</p>
              <ul className="text-xs text-slate-400 space-y-1 list-none">
                <li>• Renew or upgrade your subscription plan</li>
                <li>• Contact support at <span className="text-primary font-medium">support@convoreal.com</span></li>
                <li>• Reference your account email to speed up resolution</li>
              </ul>
            </div>
            <button
              onClick={signOut}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 transition-colors px-4 py-2.5 text-sm font-medium text-slate-300 hover:text-white"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}

      {shouldShow && status && (
        <OnboardingWizard
          status={status}
          onDismiss={dismiss}
          onRefresh={refresh}
        />
      )}

      <CreditTopup />
      <CopilotWidget />
      <TourOverlay />
    </div>
    </CopilotProvider>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <TopupModalProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </TopupModalProvider>
    </AuthProvider>
  );
}
