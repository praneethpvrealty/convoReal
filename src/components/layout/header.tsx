'use client';

import { useState, useEffect, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/hooks/use-locale';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { useTheme } from '@/hooks/use-theme';
import {
  LogOut,
  Menu,
  Moon,
  Settings as SettingsIcon,
  Sun,
  User,
  Search,
  Loader2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { storagePublicUrl } from '@/lib/storage/url';
import { formatCurrency } from '@/lib/currency-utils';
import { CreditMeter } from '@/components/layout/CreditMeter';
import { NotificationBell } from '@/components/layout/notification-bell';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';

// Only sections whose name differs from their slug need an entry. The rest
// are derived, so a screen added tomorrow is titled correctly instead of
// silently reading "Dashboard" the way /inventory and /calendar did.
// /radar, /pulse, /today, /flows, /pipelines, /ads, /agents and
// /requirements are redirect-only shims onto a tab of another section, so
// they are deliberately absent — the title comes from where you land.
const pageTitleOverrides: Record<string, string> = {
  '/admin': 'Admin Panel',
};

export function getPageTitle(pathname: string): string {
  const [section] = pathname.split('/').filter(Boolean);
  if (!section) return 'Dashboard';
  return (
    pageTitleOverrides[`/${section}`] ??
    section
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}
interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const t = useT();
  const title = getPageTitle(pathname);
  const supabase = createClient();

  const [searchOpen, setSearchOpen] = useState(false);

  // Search-result links whose target PATHNAME is the page we're
  // already on (e.g. picking a contact while on /contacts) would be
  // silently swallowed by the router in production builds — drive
  // those through the History API instead (see src/lib/navigation.ts).
  const handleResultClick = (e: MouseEvent<HTMLAnchorElement>, url: string) => {
    setSearchOpen(false);
    if (window.location.pathname === url.split('?')[0]) {
      e.preventDefault();
      window.history.pushState(null, '', url);
    }
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [contactsResults, setContactsResults] = useState<
    {
      id: string;
      name: string | null;
      phone: string;
      email: string | null;
      name_tag?: string | null;
    }[]
  >([]);
  const [dealsResults, setDealsResults] = useState<
    { id: string; title: string; value: number | null; currency: string }[]
  >([]);
  const [propertiesResults, setPropertiesResults] = useState<
    { id: string; title: string; location: string | null; status: string }[]
  >([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery('');
      setContactsResults([]);
      setDealsResults([]);
      setPropertiesResults([]);
      return;
    }

    if (!searchQuery.trim()) {
      setContactsResults([]);
      setDealsResults([]);
      setPropertiesResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      setSearching(true);
      try {
        const query = searchQuery.trim();
        const cleanQuery = query.replace(/"/g, '\\"');
        const pattern = `"%${cleanQuery}%"`;

        const [contactsRes, dealsRes, propertiesRes] = await Promise.all([
          supabase
            .from('contacts')
            .select('id, name, phone, email, name_tag')
            .eq('account_id', profile?.account_id)
            .eq('is_merged', false)
            .or(
              `name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`
            )
            .limit(5),
          supabase
            .from('deals')
            .select('id, title, value, currency')
            .eq('account_id', profile?.account_id)
            .ilike('title', `%${query}%`)
            .limit(5),
          supabase
            .from('properties')
            .select('id, title, location, status')
            .eq('account_id', profile?.account_id)
            .or(`title.ilike.${pattern},location.ilike.${pattern}`)
            .limit(5),
        ]);

        setContactsResults(contactsRes.data ?? []);
        setDealsResults(dealsRes.data ?? []);
        setPropertiesResults(propertiesRes.data ?? []);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(handler);
  }, [searchQuery, searchOpen, supabase, profile?.account_id]);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-900/60 bg-slate-950/80 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="flex h-10 w-10 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-800/40 hover:text-white lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="mr-4 truncate text-base font-bold text-white sm:text-lg">
          {title}
        </h1>
      </div>

      <LanguageToggle />

      {/* Global Search Bar input trigger */}
      <div
        onClick={() => setSearchOpen(true)}
        className="group relative hidden w-72 cursor-pointer md:block lg:w-96"
      >
        <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500 transition-colors group-hover:text-slate-400" />
        <div className="flex h-[28px] w-full items-center rounded-lg border border-slate-900 bg-slate-900/40 py-1.5 pr-12 pl-9 text-xs text-slate-400 transition-all select-none hover:border-slate-800 hover:bg-slate-950">
          {t('search.placeholder')}
        </div>
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 inline-flex h-5 -translate-y-1/2 items-center gap-0.5 rounded border border-slate-800 bg-slate-950 px-1.5 font-mono text-[9px] font-medium text-slate-500 select-none">
          <span className="text-[10px]">⌘</span>K
        </kbd>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-xl overflow-hidden rounded-2xl border-slate-800 bg-slate-900/95 p-0 text-white shadow-2xl backdrop-blur-md">
          <div className="flex items-center border-b border-slate-800 px-4 py-3">
            <Search className="mr-3 h-4 w-4 shrink-0 text-slate-500" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              className="w-full border-0 bg-transparent py-1 text-sm font-medium outline-none placeholder:text-slate-500"
            />
            {searching && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" />
            )}
          </div>

          <div className="max-h-[380px] space-y-4 overflow-y-auto p-4">
            {!searchQuery.trim() && (
              <div className="py-10 text-center text-xs text-slate-400">
                Type something to start searching...
              </div>
            )}

            {searchQuery.trim() &&
              !searching &&
              contactsResults.length === 0 &&
              dealsResults.length === 0 &&
              propertiesResults.length === 0 && (
                <div className="py-10 text-center text-xs text-slate-400">
                  No results found for &ldquo;{searchQuery}&rdquo;
                </div>
              )}

            {contactsResults.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  👤 Contacts
                </h4>
                <div className="grid gap-1">
                  {contactsResults.map((c) => (
                    <Link
                      key={c.id}
                      href={`/contacts?contactId=${c.id}`}
                      onClick={(e) =>
                        handleResultClick(e, `/contacts?contactId=${c.id}`)
                      }
                      className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-800/40 p-2.5 text-left transition-all hover:border-slate-700 hover:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-white">
                          <span className="truncate">
                            {c.name || '(No Name)'}
                          </span>
                          <NameTagBadge tag={c.name_tag} />
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {c.phone} {c.email ? `· ${c.email}` : ''}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {dealsResults.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  💼 Deals
                </h4>
                <div className="grid gap-1">
                  {dealsResults.map((d) => (
                    <Link
                      key={d.id}
                      href={`/deals?view=board&dealId=${d.id}`}
                      onClick={(e) =>
                        handleResultClick(e, `/deals?view=board&dealId=${d.id}`)
                      }
                      className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-800/40 p-2.5 text-left transition-all hover:border-slate-700 hover:bg-slate-800"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {d.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          Value:{' '}
                          {formatCurrency(d.value ?? 0, d.currency || 'INR')}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {propertiesResults.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  🏡 Properties
                </h4>
                <div className="grid gap-1">
                  {propertiesResults.map((p) => (
                    <Link
                      key={p.id}
                      href={`/inventory?propertyId=${p.id}`}
                      onClick={(e) =>
                        handleResultClick(e, `/inventory?propertyId=${p.id}`)
                      }
                      className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-800/40 p-2.5 text-left transition-all hover:border-slate-700 hover:bg-slate-800"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {p.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {p.location} ·{' '}
                          <span className="text-primary font-medium">
                            {p.status}
                          </span>
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          aria-label={
            mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
          }
          title={
            mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
          }
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-white"
        >
          {mode === 'dark' ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </button>

        <CreditMeter />

        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-slate-800/70 focus:bg-slate-800/70 focus:outline-none data-popup-open:bg-slate-800/70 sm:gap-3 sm:pr-3 sm:pl-1"
            aria-label="Open account menu"
          >
            <Avatar className="size-8">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={storagePublicUrl(profile.avatar_url)}
                  alt={profile.full_name ?? 'Avatar'}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-white sm:inline">
              {profile?.full_name ?? 'User'}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="min-w-56 bg-slate-900 text-slate-100 ring-slate-700"
          >
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-white">
                {profile?.full_name ?? 'User'}
              </p>
              <p className="truncate text-xs text-slate-400">
                {profile?.email ?? ''}
              </p>
            </div>
            <DropdownMenuSeparator className="bg-slate-800" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
                  prefetch={false}
                  className="text-slate-200 focus:bg-slate-800 focus:text-white"
                />
              }
            >
              <User className="size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=whatsapp"
                  prefetch={false}
                  className="text-slate-200 focus:bg-slate-800 focus:text-white"
                />
              }
            >
              <SettingsIcon className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-slate-800" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-slate-200 focus:bg-slate-800 focus:text-white"
            >
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
