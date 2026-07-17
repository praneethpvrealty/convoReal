"use client";

// ============================================================
// Owners Den — portal shell. Deliberately minimal and OWNER-facing:
// no CRM nav, no agent tooling. Top bar + bottom-tab nav on mobile.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Building2, HandCoins, Settings, LogOut, KeyRound } from "lucide-react";

import { useDen } from "./den-provider";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/den", label: "Overview", icon: Home, exact: true },
  { href: "/den/properties", label: "My Properties", icon: Building2, exact: false },
  { href: "/den/bids", label: "Offers", icon: HandCoins, exact: false },
  { href: "/den/settings", label: "Settings", icon: Settings, exact: false },
];

export function DenShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, loading, signOut } = useDen();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <KeyRound className="h-8 w-8 animate-pulse" />
          <p className="text-sm font-medium">Opening your Owners Den…</p>
        </div>
      </div>
    );
  }

  const firstName = me?.display_name?.trim().split(/\s+/)[0] || null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link href="/den" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <KeyRound className="h-4 w-4 text-primary" />
            </span>
            <span className="text-sm font-black tracking-tight">Owners Den</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            {firstName && (
              <span className="hidden text-xs font-semibold text-muted-foreground sm:inline">
                Hi, {firstName}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={signOut} className="text-xs font-bold">
              <LogOut className="mr-1 h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 md:pb-8">{children}</main>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-5xl items-stretch justify-around">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
