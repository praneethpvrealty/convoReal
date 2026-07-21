"use client";

import { useState, useEffect, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { LogOut, Menu, Moon, Settings as SettingsIcon, Sun, User, Search, Loader2 } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { storagePublicUrl } from "@/lib/storage/url";
import { formatCurrency } from "@/lib/currency-utils";
import { CreditMeter } from "@/components/layout/CreditMeter";
import { NameTagBadge } from "@/components/contacts/name-tag-badge";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inbox": "Inbox",
  "/contacts": "Contacts",
  "/pipelines": "Pipelines",
  "/broadcasts": "Broadcasts",
  "/automations": "Automations",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "Dashboard";
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
  const title = getPageTitle(pathname);
  const supabase = createClient();

  const [searchOpen, setSearchOpen] = useState(false);

  // Search-result links whose target PATHNAME is the page we're
  // already on (e.g. picking a contact while on /contacts) would be
  // silently swallowed by the router in production builds — drive
  // those through the History API instead (see src/lib/navigation.ts).
  const handleResultClick = (
    e: MouseEvent<HTMLAnchorElement>,
    url: string,
  ) => {
    setSearchOpen(false);
    if (window.location.pathname === url.split("?")[0]) {
      e.preventDefault();
      window.history.pushState(null, "", url);
    }
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [contactsResults, setContactsResults] = useState<{ id: string; name: string | null; phone: string; email: string | null; name_tag?: string | null }[]>([]);
  const [dealsResults, setDealsResults] = useState<{ id: string; title: string; value: number | null; currency: string }[]>([]);
  const [propertiesResults, setPropertiesResults] = useState<{ id: string; title: string; location: string | null; status: string }[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("");
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
            .from("contacts")
            .select("id, name, phone, email, name_tag")
            .eq("account_id", profile?.account_id)
            .eq("is_merged", false)
            .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
            .limit(5),
          supabase
            .from("deals")
            .select("id, title, value, currency")
            .eq("account_id", profile?.account_id)
            .ilike("title", `%${query}%`)
            .limit(5),
          supabase
            .from("properties")
            .select("id, title, location, status")
            .eq("account_id", profile?.account_id)
            .or(`title.ilike.${pattern},location.ilike.${pattern}`)
            .limit(5),
        ]);

        setContactsResults(contactsRes.data ?? []);
        setDealsResults(dealsRes.data ?? []);
        setPropertiesResults(propertiesRes.data ?? []);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(handler);
  }, [searchQuery, searchOpen, supabase, profile?.account_id]);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-900/60 bg-slate-950/80 backdrop-blur-md px-4 lg:px-6 relative z-20">
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
        <h1 className="truncate text-base font-bold text-white sm:text-lg mr-4">
          {title}
        </h1>
      </div>

      {/* Global Search Bar input trigger */}
      <div 
        onClick={() => setSearchOpen(true)}
        className="relative hidden md:block w-72 lg:w-96 cursor-pointer group"
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-500 group-hover:text-slate-400 transition-colors" />
        <div className="w-full bg-slate-900/40 border border-slate-900 rounded-lg pl-9 pr-12 py-1.5 text-xs text-slate-400 transition-all select-none hover:bg-slate-950 hover:border-slate-800 flex items-center h-[28px]">
          Search deals, contacts, or properties...
        </div>
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border border-slate-800 bg-slate-950 px-1.5 font-mono text-[9px] font-medium text-slate-500">
          <span className="text-[10px]">⌘</span>K
        </kbd>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-xl bg-slate-900/95 backdrop-blur-md border-slate-800 text-white p-0 overflow-hidden shadow-2xl rounded-2xl">
          <div className="flex items-center border-b border-slate-800 px-4 py-3">
            <Search className="mr-3 h-4 w-4 text-slate-500 shrink-0" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search deals, contacts, or properties..."
              className="w-full bg-transparent border-0 outline-none placeholder:text-slate-500 text-sm py-1 font-medium"
            />
            {searching && (
              <Loader2 className="h-4 w-4 animate-spin text-slate-500 shrink-0" />
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto p-4 space-y-4">
            {!searchQuery.trim() && (
              <div className="text-center text-xs text-slate-400 py-10">
                Type something to start searching...
              </div>
            )}

            {searchQuery.trim() && !searching && contactsResults.length === 0 && dealsResults.length === 0 && propertiesResults.length === 0 && (
              <div className="text-center text-xs text-slate-400 py-10">
                No results found for &ldquo;{searchQuery}&rdquo;
              </div>
            )}

            {contactsResults.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 px-2">
                  👤 Contacts
                </h4>
                <div className="grid gap-1">
                  {contactsResults.map((c) => (
                    <Link
                      key={c.id}
                      href={`/contacts?contactId=${c.id}`}
                      onClick={(e) => handleResultClick(e, `/contacts?contactId=${c.id}`)}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/60 hover:bg-slate-800 hover:border-slate-700 transition-all text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{c.name || "(No Name)"}</span>
                          <NameTagBadge tag={c.name_tag} />
                        </p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {c.phone} {c.email ? `· ${c.email}` : ""}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {dealsResults.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 px-2">
                  💼 Deals
                </h4>
                <div className="grid gap-1">
                  {dealsResults.map((d) => (
                    <Link
                      key={d.id}
                      href={`/pipelines?dealId=${d.id}`}
                      onClick={(e) => handleResultClick(e, `/pipelines?dealId=${d.id}`)}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/60 hover:bg-slate-800 hover:border-slate-700 transition-all text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {d.title}
                        </p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          Value: {formatCurrency(d.value ?? 0, d.currency || "INR")}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {propertiesResults.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 px-2">
                  🏡 Properties
                </h4>
                <div className="grid gap-1">
                  {propertiesResults.map((p) => (
                    <Link
                      key={p.id}
                      href={`/inventory?propertyId=${p.id}`}
                      onClick={(e) => handleResultClick(e, `/inventory?propertyId=${p.id}`)}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-800/60 hover:bg-slate-800 hover:border-slate-700 transition-all text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {p.title}
                        </p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {p.location} · <span className="text-primary font-medium">{p.status}</span>
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
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
          aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-white"
        >
          {mode === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </button>

        <CreditMeter />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-slate-800/70 focus:bg-slate-800/70 focus:outline-none data-popup-open:bg-slate-800/70 sm:gap-3 sm:pl-1 sm:pr-3"
            aria-label="Open account menu"
          >
            <Avatar className="size-8">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={storagePublicUrl(profile.avatar_url)}
                  alt={profile.full_name ?? "Avatar"}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-white sm:inline">
              {profile?.full_name ?? "User"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="min-w-56 bg-slate-900 text-slate-100 ring-slate-700"
          >
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-white">
                {profile?.full_name ?? "User"}
              </p>
              <p className="truncate text-xs text-slate-400">
                {profile?.email ?? ""}
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
