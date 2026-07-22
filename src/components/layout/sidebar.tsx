"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { storagePublicUrl } from "@/lib/storage/url";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { SidebarCreditWidget } from "@/components/layout/SidebarCreditWidget";
import { FavoritesCard } from "@/components/layout/favorites-card";
import {
  Crown,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  Megaphone,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Waypoints,
  Workflow,
  X,
  Home,
  Calendar,
  Landmark,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Owner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agent",
    // Neutral slate: the operational default.
    className:
      "border-slate-700 bg-slate-800 text-slate-300",
  },
  viewer: {
    icon: User,
    label: "Viewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-slate-800 bg-slate-900 text-slate-500",
  },
};
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

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/inventory", label: "Inventory", icon: Home },
  { href: "/liaisons", label: "Liaisons", icon: Landmark },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/journey", label: "Journey", icon: Waypoints, beta: true },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/broadcasts", label: "Broadcasts", icon: Radio },
  // Meta Ads surfaces (incl. this nav item) only render when the feature is
  // enabled at build via NEXT_PUBLIC_META_ADS_APP_ID.
  ...(process.env.NEXT_PUBLIC_META_ADS_APP_ID
    ? [{ href: "/ads", label: "Ads", icon: Megaphone }]
    : []),
];

const bottomNavItems = [
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

// Same flag key the Members tab and Settings page use. Flip per
// profile via Supabase Studio to dogfood the multi-user surface.
const ACCOUNT_SHARING_FLAG = "account_sharing";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  // Match the settings page's check: only treat the flag as enabled
  // once the profile has finished loading. Without this, the strip
  // would briefly flash absent during the initial profile fetch
  // (when `profile` is null and the boolean coerces to false), then
  // pop in once the row resolves — visible as a layout jump in the
  // sidebar footer.
  const accountSharingEnabled =
    !profileLoading &&
    !!profile?.beta_features?.includes(ACCOUNT_SHARING_FLAG);

  const dynamicBottomItems = [
    ...(profile?.role === 'super_admin' ? [{ href: "/admin", label: "Admin Panel", icon: Shield }] : []),
    ...bottomNavItems,
  ];

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-slate-900/60 bg-slate-950/45 backdrop-blur-xl",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Decorative ambient glow */}
        <div className="absolute top-0 left-0 right-0 h-48 bg-gradient-to-b from-primary/8 to-transparent pointer-events-none blur-3xl" />

        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-900/60 px-4 bg-slate-950/20 backdrop-blur-sm relative z-10">
          <Link href="/dashboard" prefetch={false} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-indigo-650 text-white shadow-md shadow-primary/20">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-black tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              CONVOREAL CRM
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800/40 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 relative z-10">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    data-tour={`nav-${item.href.slice(1)}`}
                    className={cn(
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      "flex items-center gap-3 px-3 py-2.5 text-sm font-semibold transition-all duration-300 lg:py-2",
                      isActive
                        ? "bg-primary/10 text-white border border-primary/25 shadow-md shadow-primary/5 rounded-xl"
                        : "text-slate-400 hover:text-white hover:bg-slate-900/40 hover:pl-4 rounded-xl border border-transparent",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.beta && (
                      <span
                        aria-label="Beta feature"
                        className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-amber-300 shrink-0"
                      >
                        Beta
                      </span>
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
                        className="relative flex h-2 w-2 shrink-0"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-4 border-t border-slate-900/60" />

          <ul className="flex flex-col gap-1">
            {dynamicBottomItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    data-tour={`nav-${item.href.slice(1)}`}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 text-sm font-semibold transition-all duration-300 lg:py-2",
                      isActive
                        ? "bg-primary/10 text-white border border-primary/25 shadow-md shadow-primary/5 rounded-xl"
                        : "text-slate-400 hover:text-white hover:bg-slate-900/40 hover:pl-4 rounded-xl border border-transparent",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Quick Access section */}
          <div className="my-6 border-t border-slate-900/60 pt-4 px-1">
            <h3 className="text-[10px] font-black text-slate-550 uppercase tracking-widest mb-3 px-3">
              Quick Access
            </h3>
            <div className="flex flex-col gap-1.5">
              {[
                { label: "New Deals", href: "/pipelines?new=true" },
                { label: "Pending Quotes", href: "/inbox?filter=pending" },
                { label: "Priority Tasks", href: "/calendar?filter=priority" },
                { label: "Follow-ups", href: "/contacts?search=follow-up" },
              ].map((qa) => (
                <Link
                  key={qa.label}
                  href={qa.href}
                  prefetch={false}
                  className="w-full text-left text-xs font-bold text-slate-450 hover:text-white bg-slate-900/15 hover:bg-slate-900/45 border border-slate-900/60 hover:border-slate-800 px-4 py-2 rounded-xl transition-all duration-200 cursor-pointer"
                >
                  {qa.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <FavoritesCard />
        <SidebarCreditWidget />

        {/* User section */}
        <div className="shrink-0 border-t border-slate-900/60 p-3 bg-slate-950/10 backdrop-blur-sm relative z-10">
          {/* Account name display — only surfaced when the user is
              opted into the account_sharing beta flag. For solo
              users (the default) the account is named after them,
              so showing it here would just duplicate the user name
              below. Once the flag is on the user is at minimum
              aware of which shared account they're acting in. */}
          {accountSharingEnabled && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-slate-500">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {meta.label}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-800/60 focus:bg-slate-800/60 focus:outline-none data-popup-open:bg-slate-800/60">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={storagePublicUrl(profile.avatar_url)}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-slate-900 text-slate-100 ring-slate-700"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    prefetch={false}
                    onClick={onClose}
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
                    onClick={onClose}
                    className="text-slate-200 focus:bg-slate-800 focus:text-white"
                  />
                }
              >
                <Settings className="size-4" />
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
      </aside>
    </>
  );
}
