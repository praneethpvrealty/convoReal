"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import type { Conversation, ConversationStatus, Team } from "@/types";
import { Search, ChevronDown, MoreVertical, Archive, ArchiveRestore, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { FavoriteButton } from "@/components/layout/favorite-button";
import { MessageBubbleLoader } from "@/components/ui/message-bubble-loader";

/** Strip WhatsApp formatting markers (*bold*, _italic_, ~strike~) for plain-text previews. */
function stripWhatsAppFormatting(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/[*_~`]/g, '').trim();
}

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  onArchiveChange?: (conversationId: string, isArchived: boolean) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-slate-500",
};

type FilterValue = ConversationStatus | "all" | "archived";

const FILTER_OPTIONS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
  { label: "Archived", value: "archived" },
];

// ============================================================
// Assignment-scope filter (migration 082/083 org hierarchy) — a
// SECOND, independent filter dimension alongside status/search
// above. RLS already restricts which rows this component ever
// receives (an Org Agent's fetch physically cannot return another
// agent's conversations), so these are convenience tabs on top of
// an already-safe result set, not the security boundary itself —
// same split as everywhere else in this codebase: RLS enforces,
// the UI just narrows what's shown.
// ============================================================

/** "team:<id>" for a specific team (Manager only); otherwise a fixed tab. */
type ScopeFilterValue = "all" | "unassigned" | "mine" | `team:${string}`;

function scopeOptionsFor(
  orgRole: "org_manager" | "org_leader" | "org_agent" | null,
  teams: Team[],
): { label: string; value: ScopeFilterValue; icon?: boolean }[] {
  if (orgRole === "org_manager") {
    return [
      { label: "All", value: "all" },
      { label: "Unassigned", value: "unassigned" },
      { label: "Mine", value: "mine" },
      ...teams.map((t) => ({ label: t.name, value: `team:${t.id}` as ScopeFilterValue, icon: true })),
    ];
  }
  if (orgRole === "org_leader") {
    return [
      { label: "My Team", value: "all" },
      { label: "Unassigned", value: "unassigned" },
      { label: "Mine", value: "mine" },
    ];
  }
  // org_agent, or role not yet loaded — RLS already scopes them to
  // their own conversations, so "Mine" is the only meaningful tab.
  return [{ label: "Mine", value: "mine" }];
}

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  onArchiveChange,
  resyncToken = 0,
}: ConversationListProps) {
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get("filter") as FilterValue) || "all";
  const initialSearch = searchParams.get("search") || "";
  const { orgRole, accountId, user, profile } = useAuth();

  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<FilterValue>(
    FILTER_OPTIONS.some((o) => o.value === initialFilter) ? initialFilter : "all"
  );
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>("all");
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  // True once the very first fetch has completed — subsequent resyncs
  // are silent merges and must NOT reset loading to true (that would
  // replace the visible list with a spinner on every tab focus / reconnect).
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    const filterParam = searchParams.get("filter") as FilterValue;
    const searchParam = searchParams.get("search");

    const timer = setTimeout(() => {
      if (filterParam && FILTER_OPTIONS.some((o) => o.value === filterParam)) {
        setFilter(filterParam);
      }
      if (searchParam !== null) {
        setSearch(searchParam);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams]);

  // Manager-only: fetch teams for the "by team" scope tabs. Cheap and
  // RLS-scoped like everything else here; skipped entirely for
  // Leader/Agent since they never see this dropdown option.
  useEffect(() => {
    if (orgRole !== "org_manager" || !accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("teams")
        .select("*")
        .eq("account_id", accountId)
        .order("name", { ascending: true });
      if (!cancelled) setTeams((data as Team[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgRole, accountId]);

  // Derived (not stored) — Org Agents only have one meaningful scope
  // tab ("Mine"), and a Leader/Manager's stored selection could point
  // at a team dropdown option that no longer applies if their role
  // changes mid-session. Falling back to the first valid option here
  // (render time) avoids an effect just to keep state "in sync" with
  // itself — see https://react.dev/learn/you-might-not-need-an-effect.
  const scopeOptions = useMemo(() => scopeOptionsFor(orgRole, teams), [orgRole, teams]);
  const effectiveScope: ScopeFilterValue = scopeOptions.some((o) => o.value === scopeFilter)
    ? scopeFilter
    : scopeOptions[0].value;

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const isResync = initialLoadDoneRef.current;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      let fetched = data ?? [];

      if (profile?.phone) {
        const userPhoneDigits = profile.phone.replace(/\D/g, "");
        fetched = fetched.filter(
          (c) => !c.contact?.phone || c.contact.phone.replace(/\D/g, "") !== userPhoneDigits
        );
      }

      if (isResync) {
        // Silent merge: update changed rows and prepend brand-new ones.
        // This avoids replacing the entire list (and triggering a full
        // re-render / flicker) every time the tab regains focus or the
        // realtime channel reconnects.
        onConversationsLoadedRef.current(fetched);
      } else {
        // First load — hand the full list to the parent as before.
        onConversationsLoadedRef.current(fetched);
        initialLoadDoneRef.current = true;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken, profile?.phone]);

  const userPhoneDigits = profile?.phone ? profile.phone.replace(/\D/g, "") : "";

  const filtered = useMemo(() => {
    let result = conversations;

    if (userPhoneDigits) {
      result = result.filter(
        (c) => !c.contact?.phone || c.contact.phone.replace(/\D/g, "") !== userPhoneDigits
      );
    }

    if (filter === "archived") {
      result = result.filter((c) => c.is_archived);
    } else {
      // Hide archived conversations from all non-archived views
      result = result.filter((c) => !c.is_archived);
      if (filter !== "all") {
        result = result.filter((c) => c.status === filter);
      }
    }

    // Assignment-scope tab — convenience narrowing on top of the
    // already-RLS-restricted result set (see scopeOptionsFor above).
    if (effectiveScope === "unassigned") {
      result = result.filter((c) => !c.assigned_agent_id && !c.assigned_team_id);
    } else if (effectiveScope === "mine") {
      result = result.filter((c) => c.assigned_agent_id === user?.id);
    } else if (effectiveScope.startsWith("team:")) {
      const scopedTeamId = effectiveScope.slice("team:".length);
      result = result.filter((c) => c.assigned_team_id === scopedTeamId);
    }
    // effectiveScope === "all": no extra filter. For a Leader this is
    // their "My Team" tab — RLS already excludes other teams'
    // conversations, so "all [I can see]" IS "my team" for them.

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, search, effectiveScope, user?.id, userPhoneDigits]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const handleArchiveToggle = useCallback(
    async (conv: Conversation, e: React.MouseEvent) => {
      e.stopPropagation();
      const newArchived = !conv.is_archived;
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ is_archived: newArchived })
        .eq("id", conv.id);

      if (error) {
        toast.error("Failed to update conversation");
        return;
      }

      onArchiveChange?.(conv.id, newArchived);
      toast.success(newArchived ? "Conversation archived" : "Conversation unarchived", {
        action: {
          label: "Undo",
          onClick: async () => {
            const supabase2 = createClient();
            await supabase2
              .from("conversations")
              .update({ is_archived: !newArchived })
              .eq("id", conv.id);
            onArchiveChange?.(conv.id, !newArchived);
          },
        },
      });
    },
    [onArchiveChange]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);
  const activeScope = scopeOptions.find((o) => o.value === effectiveScope) ?? scopeOptions[0];

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-slate-900/60 bg-slate-950/45 backdrop-blur-xl lg:w-80 min-h-0 overflow-hidden">
      {/* Search + Filter */}
      <div className="space-y-2.5 border-b border-slate-900/60 p-3.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder="Search conversations..."
              className="border-slate-850 bg-slate-950/40 pl-9 text-sm text-white placeholder-slate-550 focus:border-primary/50 rounded-xl transition-all"
            />
          </div>
          <FavoriteButton label="Inbox" href="/inbox" icon="MessageSquare" />
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-350 hover:text-white rounded-xl border border-slate-900 bg-slate-950/20 hover:bg-slate-900/50 cursor-pointer transition-all">
                {activeFilter?.label ?? "All"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-slate-900 bg-slate-950/95 backdrop-blur-xl"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : opt.value === "archived" ? "text-slate-400" : "text-slate-300"
                  )}
                >
                  {opt.value === "archived" && <Archive className="mr-2 h-3 w-3" />}
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assignment-scope tab (org hierarchy) — only rendered once
              orgRole has loaded and offers more than the single "Mine"
              option every role trivially has. */}
          {scopeOptions.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-350 hover:text-white rounded-xl border border-slate-900 bg-slate-950/20 hover:bg-slate-900/50 cursor-pointer transition-all">
                <Users className="h-3 w-3" />
                {activeScope?.label ?? "All"}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-slate-900 bg-slate-950/95 backdrop-blur-xl"
              >
                {scopeOptions.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => setScopeFilter(opt.value)}
                    className={cn(
                      "text-sm",
                      effectiveScope === opt.value ? "text-primary" : "text-slate-300"
                    )}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Conversation Items */}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <MessageBubbleLoader size={44} label="Loading conversations" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">
              {filter === "archived" ? "No archived conversations" : "No conversations found"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                onArchiveToggle={handleArchiveToggle}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  onArchiveToggle: (conv: Conversation, e: React.MouseEvent) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onArchiveToggle,
}: ConversationItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  const isUnread = conversation.unread_count > 0;

  return (
    <div
      className={cn(
        "group relative flex w-full items-start gap-3 px-3.5 py-3.5 text-left transition-all hover:pl-4.5 border-l-2 select-none cursor-pointer duration-200",
        isActive
          ? "border-l-primary bg-primary/10 text-white hover:pl-3.5"
          : isUnread
          ? "border-l-primary bg-slate-900/60 text-white hover:bg-slate-900/85 hover:pl-4.5"
          : "border-l-transparent text-slate-400 hover:bg-slate-900/30 hover:pl-4.5"
      )}
    >
      <button
        onClick={handleClick}
        className="flex flex-1 items-start gap-3 min-w-0 text-left"
      >
        {/* Avatar */}
        <div className={cn(
          "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 border text-sm font-bold transition-all",
          isActive
            ? "border-primary text-primary-foreground"
            : isUnread
            ? "border-primary/60 text-white shadow-[0_0_8px_hsl(var(--primary)/0.25)]"
            : "border-slate-750 text-slate-400"
        )}>
          {contact?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
          )}
          {/* Unread pulse dot on avatar */}
          {isUnread && !isActive && (
            <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-slate-950 animate-pulse" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              "truncate text-sm transition-all",
              isActive
                ? "font-semibold text-white"
                : isUnread
                ? "font-bold text-white text-md tracking-wide"
                : "font-normal text-slate-400"
            )}>
              {displayName}
            </span>
            <span className={cn(
              "shrink-0 text-[10px] transition-all",
              isActive
                ? "text-primary-foreground/70"
                : isUnread
                ? "text-primary font-bold"
                : "text-slate-500"
            )}>{timeAgo}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className={cn(
              "truncate text-xs transition-all",
              isActive
                ? "text-slate-200"
                : isUnread
                ? "text-slate-100 font-semibold"
                : "text-slate-500 font-normal"
            )}>
              {stripWhatsAppFormatting(conversation.last_message_text) || "No messages yet"}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {isUnread && (
                <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1.5 text-[9px] font-black text-primary-foreground shadow-[0_0_8px_hsl(var(--primary)/0.6)]">
                  {conversation.unread_count}
                </span>
              )}
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  conversation.is_archived
                    ? "bg-slate-600"
                    : STATUS_COLORS[conversation.status]
                )}
                title={conversation.is_archived ? "archived" : conversation.status}
              />
            </div>
          </div>
        </div>
      </button>

      {/* Context menu — archive / unarchive */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          onClick={(e) => { e.stopPropagation(); }}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:text-white hover:bg-slate-700 transition-opacity",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          aria-label="Conversation options"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-slate-900 bg-slate-950/95 backdrop-blur-xl min-w-36">
          <DropdownMenuItem
            onClick={(e) => { setMenuOpen(false); onArchiveToggle(conversation, e); }}
            className="gap-2 text-sm text-slate-300"
          >
            {conversation.is_archived ? (
              <><ArchiveRestore className="h-3.5 w-3.5 text-slate-400" /> Unarchive</>
            ) : (
              <><Archive className="h-3.5 w-3.5 text-slate-400" /> Archive</>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
