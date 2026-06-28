"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { Search, ChevronDown, MoreVertical, Archive, ArchiveRestore } from "lucide-react";
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

  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<FilterValue>(
    FILTER_OPTIONS.some((o) => o.value === initialFilter) ? initialFilter : "all"
  );
  const [loading, setLoading] = useState(true);

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

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "archived") {
      result = result.filter((c) => c.is_archived);
    } else {
      // Hide archived conversations from all non-archived views
      result = result.filter((c) => !c.is_archived);
      if (filter !== "all") {
        result = result.filter((c) => c.status === filter);
      }
    }

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
  }, [conversations, filter, search]);

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

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-slate-900/60 bg-slate-950/45 backdrop-blur-xl lg:w-80 min-h-0 overflow-hidden">
      {/* Search + Filter */}
      <div className="space-y-2.5 border-b border-slate-900/60 p-3.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search conversations..."
            className="border-slate-850 bg-slate-950/40 pl-9 text-sm text-white placeholder-slate-550 focus:border-primary/50 rounded-xl transition-all"
          />
        </div>

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
      </div>

      {/* Conversation Items */}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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

  return (
    <div
      className={cn(
        "group relative flex w-full items-start gap-3 px-3.5 py-3.5 text-left transition-all hover:bg-slate-900/40 hover:pl-4.5 border-l-2 border-transparent select-none cursor-pointer duration-200",
        isActive && "border-l-2 border-primary bg-primary/8 text-white hover:pl-3.5"
      )}
    >
      <button
        onClick={handleClick}
        className="flex flex-1 items-start gap-3 min-w-0 text-left"
      >
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 border border-slate-750 text-sm font-bold text-slate-300">
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
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-white">
              {displayName}
            </span>
            <span className="shrink-0 text-[10px] text-slate-500">{timeAgo}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-slate-400">
              {conversation.last_message_text || "No messages yet"}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {conversation.unread_count > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
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
