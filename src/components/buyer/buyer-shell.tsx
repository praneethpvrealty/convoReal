'use client';

// ============================================================
// Buyer portal — shell. Deliberately minimal and BUYER-facing: no
// CRM nav, no agent tooling. Top bar + bottom-tab nav on mobile.
// ============================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, SlidersHorizontal, Settings, LogOut, Home } from 'lucide-react';

import { useBuyer } from './buyer-provider';
import { Button } from '@/components/ui/button';

const NAV = [
  { href: '/buyer', label: 'Shortlist', icon: Heart, exact: true },
  {
    href: '/buyer/preferences',
    label: 'Preferences',
    icon: SlidersHorizontal,
    exact: false,
  },
  { href: '/buyer/settings', label: 'Settings', icon: Settings, exact: false },
];

export function BuyerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, loading, signOut } = useBuyer();

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground flex flex-col items-center gap-3">
          <Home className="h-8 w-8 animate-pulse" />
          <p className="text-sm font-medium">Opening your buyer portal…</p>
        </div>
      </div>
    );
  }

  const firstName = me?.display_name?.trim().split(/\s+/)[0] || null;

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="bg-background/95 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link href="/buyer" className="flex items-center gap-2">
            <span className="bg-primary/10 border-primary/20 flex h-8 w-8 items-center justify-center rounded-xl border">
              <Home className="text-primary h-4 w-4" />
            </span>
            <span className="text-sm font-black tracking-tight">
              My Properties
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            {firstName && (
              <span className="text-muted-foreground hidden text-xs font-semibold sm:inline">
                Hi, {firstName}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-xs font-bold"
            >
              <LogOut className="mr-1 h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 md:pb-8">
        {children}
      </main>

      <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-5xl items-stretch justify-around">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold ${
                  active ? 'text-primary' : 'text-muted-foreground'
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
